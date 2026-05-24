import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer';
import { CONFIG } from '../scene-config.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// --- 初始化變數 ---
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let prevTime = performance.now();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const collidableObjects = [];
const interactiveDoors = [];

// --- [新增] 水流互動相關變數 ---
const raycaster = new THREE.Raycaster();
const interactiveDevices = []; // 存放 faucet, shower, toilet
const flowingPipes = new Map(); // 存放管路物件與其狀態

// --- 1. 場景基礎設置 ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CONFIG.CAMERA.fov, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(CONFIG.CAMERA.startPos.x, CONFIG.CAMERA.startPos.y, CONFIG.CAMERA.startPos.z);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85; // 保持 0.85
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// --- 2. 後處理 (Bloom) [保持原始參數] ---
let composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.2,   // 保持 0.2
    0.5,   // 保持 0.5
    0.85   // 保持 0.85
);
composer.addPass(bloomPass);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0px';
labelRenderer.domElement.style.pointerEvents = 'none';
document.body.appendChild(labelRenderer.domElement);

// --- [新增] 水流材質生成函式 (使用半透明避免過亮) ---
function createFlowMaterial(color) {
    return new THREE.MeshStandardMaterial({
        color: color,
        transparent: true,
        opacity: 0.3, // 低透明度，平時幾乎看不見
        emissive: color,
        emissiveIntensity: 0, // 初始不發光
        side: THREE.DoubleSide
    });
}

// --- 3. 圓錐氛圍光體生成函式 (保持原始代碼) ---
function createConeVolumetricLight(color) {
    const h = 3.2; 
    const baseRadius = 0.55; 
    const geometry = new THREE.ConeGeometry(baseRadius, h, 32, 1, true);

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(color) },
            uHeight: { value: h }
        },
        vertexShader: `
            varying float vY;
            varying vec3 vNormal;
            varying vec3 vViewDir;
            void main() {
                vY = position.y;
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vNormal = normalize(normalMatrix * normal);
                vViewDir = normalize(cameraPosition - worldPosition.xyz);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uHeight;
            varying float vY;
            varying vec3 vNormal;
            varying vec3 vViewDir;
            void main() {
                float topFade = smoothstep(uHeight/2.0, uHeight/2.0 - 0.6, vY); 
                float bottomFade = smoothstep(-uHeight/2.0, -uHeight/2.0 + 1.8, vY);
                float dotProduct = dot(vNormal, vViewDir);
                float rimFade = smoothstep(0.0, 0.4, abs(dotProduct));
                float alpha = 0.22 * topFade * bottomFade * rimFade;
                gl_FragColor = vec4(uColor, alpha);
            }
        `,
        transparent: true,
        depthWrite: false, 
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
    });

    const coneMesh = new THREE.Mesh(geometry, material);
    coneMesh.position.y = -h / 2; 
    return coneMesh;
}

// --- 4. 載入與資源管理 ---
const manager = new THREE.LoadingManager();
manager.onLoad = () => {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
        loadingScreen.classList.add('fade-out');
        setTimeout(() => { loadingScreen.style.display = 'none'; }, 1000);
    }
};

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader(manager);
loader.setDRACOLoader(dracoLoader);

scene.add(new THREE.AmbientLight(0xffffff, 0.005));

new EXRLoader(manager).load(CONFIG.MODELS.HDRI, (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdr;
});

// --- 5. 載入模型與屬性分配 ---
loader.load(CONFIG.MODELS.BUILDING, (gltf) => {
    scene.add(gltf.scene);
    gltf.scene.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const name = mesh.name.toLowerCase();

        // 燈泡與光束 (保持原始邏輯)
        if (name.includes("bulb")) {
            if (mesh.material) {
                mesh.material.emissive = new THREE.Color(0xffaa44);
                mesh.material.emissiveIntensity = 10;
                if (mesh.material.map) mesh.material.color.setHex(0x444444); 
            }
            const vConeLight = createConeVolumetricLight(0xffaa44);
            vConeLight.position.y = 0.2;
            mesh.add(vConeLight);
            const spotLight = new THREE.SpotLight(0xffaa44, 3, 5, Math.PI / 3.5, 0.6, 2);
            spotLight.position.set(0, 0, 0);
            mesh.add(spotLight);
            mesh.add(spotLight.target);
            spotLight.target.position.set(0, -10, 0);
        }

        // [新增] 辨識偵測環 (管路)
        if (name === "measure_total" || name === "measure_tank" || name === "measure_bath") {
            mesh.material = createFlowMaterial(0x00ffff);
            flowingPipes.set(name, { mesh: mesh, active: false });
        }

        // [新增] 辨識互動設備
        if (name === "faucet" || name === "shower" || name === "toilet") {
            interactiveDevices.push(mesh);
        }

        if (name.includes("door")) interactiveDoors.push(mesh);
        if (name.includes("wall") || (name.includes("door") && !name.includes("locker"))) {
            collidableObjects.push(mesh);
        }
    });
});

// --- 6. 控制與點擊互動 ---
const controls = new PointerLockControls(camera, renderer.domElement);

renderer.domElement.addEventListener('click', () => {
    if (!controls.isLocked) {
        controls.lock();
    } else {
        // [新增] 射線偵測中心點物件
        raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
        const intersects = raycaster.intersectObjects(interactiveDevices);
        
        if (intersects.length > 0) {
            const targetName = intersects[0].object.name.toLowerCase();
            
            // 根據點擊目標切換對應管路狀態
            if (targetName === 'faucet') {
                const pipe = flowingPipes.get('measure_tank');
                if (pipe) pipe.active = !pipe.active;
            } else if (targetName === 'shower') {
                const pipe = flowingPipes.get('measure_bath');
                if (pipe) pipe.active = !pipe.active;
            }
            // 總開關只要有點擊設備就開啟
            const total = flowingPipes.get('measure_total');
            if (total) total.active = true;
        }
    }
});

const onKeyDown = (e) => {
    if (e.code === 'KeyW') moveForward = true;
    if (e.code === 'KeyS') moveBackward = true;
    if (e.code === 'KeyA') moveLeft = true;
    if (e.code === 'KeyD') moveRight = true;
};
const onKeyUp = (e) => {
    if (e.code === 'KeyW') moveForward = false;
    if (e.code === 'KeyS') moveBackward = false;
    if (e.code === 'KeyA') moveLeft = false;
    if (e.code === 'KeyD') moveRight = false;
};
document.addEventListener('keydown', onKeyDown);
document.addEventListener('keyup', onKeyUp);

function animate() {
    requestAnimationFrame(animate);
    const time = performance.now() / 1000;
    const delta = Math.min(time - prevTime, 0.1);

    // [新增] 水流動畫邏輯
    flowingPipes.forEach((pipeData) => {
        if (pipeData.active) {
            // 啟動時增加自發光，但限制在 0.5 避免過曝
            pipeData.mesh.material.emissiveIntensity = 0.5;
            pipeData.mesh.material.opacity = 0.6;
            // 模擬流動脈衝感
            pipeData.mesh.material.emissiveIntensity = 0.3 + Math.sin(time * 5) * 0.2;
        } else {
            pipeData.mesh.material.emissiveIntensity = 0;
            pipeData.mesh.material.opacity = 0.1;
        }
    });

    if (controls.isLocked) {
        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;
        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize();
        if (moveForward || moveBackward) velocity.z -= direction.z * 40.0 * delta;
        if (moveLeft || moveRight) velocity.x -= direction.x * 40.0 * delta;
        controls.moveForward(-velocity.z * delta);
        controls.moveRight(-velocity.x * delta);
    }

    prevTime = time;
    composer.render();
    labelRenderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    labelRenderer.setSize(w, h);
});