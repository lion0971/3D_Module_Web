import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer';
import { CONFIG } from './scene-config.js';
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

// --- [新增] 水流與透視相關變數 ---
const raycaster = new THREE.Raycaster();
const interactiveDevices = []; 
const flowingPipes = new Map(); 
let isXRayMode = false; // 紀錄目前是否處於透視狀態

// --- 1. 場景基礎設置 ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CONFIG.CAMERA.fov, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(CONFIG.CAMERA.startPos.x, CONFIG.CAMERA.startPos.y, CONFIG.CAMERA.startPos.z);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85; 
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// --- 2. 後處理 (Bloom) [保持原始參數] ---
let composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.2,   
    0.5,   
    0.85   
);
composer.addPass(bloomPass);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0px';
labelRenderer.domElement.style.pointerEvents = 'none';
document.body.appendChild(labelRenderer.domElement);

// --- [新增] 透視模式切換函式 ---
function toggleXRayMode(enable) {
    isXRayMode = enable;
    scene.traverse((obj) => {
        if (obj.isMesh) {
            const name = obj.name.toLowerCase();
            // 如果不是管路，也不是正在點擊的設備，就變透明
            const isPipe = name.includes("measure") || name.includes("pipe");
            const isDevice = name === "faucet" || name === "shower" || name === "toilet";

            if (!isPipe && !isDevice) {
                obj.material.transparent = true;
                obj.material.opacity = enable ? 0.2 : 1.0; // 透視時透明度 0.2，正常時 1.0
                // 為了避免透明物件遮擋渲染，開啟 depthWrite
                obj.material.depthWrite = !enable; 
            }
        }
    });
}

// --- [新增] 水流材質 ---
function createFlowMaterial(color) {
    return new THREE.MeshStandardMaterial({
        color: color,
        transparent: true,
        opacity: 0, 
        emissive: color,
        emissiveIntensity: 0,
        side: THREE.DoubleSide
    });
}

// --- 3. 圓錐氛圍光體生成函式 (保持原始) ---
function createConeVolumetricLight(color) {
    const h = 3.2; 
    const geometry = new THREE.ConeGeometry(0.55, h, 32, 1, true);
    const material = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(color) }, uHeight: { value: h } },
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
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    const coneMesh = new THREE.Mesh(geometry, material);
    coneMesh.position.y = -h / 2; 
    return coneMesh;
}

// --- 4. 載入與資源管理 ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

scene.add(new THREE.AmbientLight(0xffffff, 0.005));

new EXRLoader().load(CONFIG.MODELS.HDRI, (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdr;
});

// --- 5. 載入模型與屬性分配 ---
loader.load(CONFIG.MODELS.BUILDING, (gltf) => {
    scene.add(gltf.scene);
    gltf.scene.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const name = mesh.name.toLowerCase();

        // 燈泡處理 (保持原始)
        if (name.includes("bulb")) {
            if (mesh.material) {
                mesh.material.emissive = new THREE.Color(0xffaa44);
                mesh.material.emissiveIntensity = 10;
            }
            mesh.add(createConeVolumetricLight(0xffaa44));
        }

        // 管路處理
        if (name === "measure_total" || name === "measure_tank" || name === "measure_bath") {
            mesh.material = createFlowMaterial(0x00ffff);
            flowingPipes.set(name, { mesh: mesh, active: false });
        }

        // 互動設備
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
        raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
        const intersects = raycaster.intersectObjects(interactiveDevices);
        
        if (intersects.length > 0) {
            const targetName = intersects[0].object.name.toLowerCase();
            
            // 切換透視模式與流動狀態
            let isAnyPipeActive = false;
            
            if (targetName === 'faucet') {
                const pipe = flowingPipes.get('measure_tank');
                if (pipe) pipe.active = !pipe.active;
            } else if (targetName === 'shower') {
                const pipe = flowingPipes.get('measure_bath');
                if (pipe) pipe.active = !pipe.active;
            }

            // 檢查是否還有任何管路在動，決定是否維持透視
            flowingPipes.forEach(p => { if(p.active) isAnyPipeActive = true; });
            toggleXRayMode(isAnyPipeActive);
            
            const total = flowingPipes.get('measure_total');
            if (total) total.active = isAnyPipeActive;
        } else {
            // 點擊空白處關閉所有流動與透視
            flowingPipes.forEach(p => p.active = false);
            toggleXRayMode(false);
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

// --- 7. 主迴圈 ---
function animate() {
    requestAnimationFrame(animate);
    const time = performance.now() / 1000;
    const delta = Math.min(time - prevTime, 0.1);

    flowingPipes.forEach((pipeData) => {
        if (pipeData.active) {
            pipeData.mesh.material.opacity = 0.8;
            pipeData.mesh.material.emissiveIntensity = 0.4 + Math.sin(time * 8) * 0.2;
        } else {
            pipeData.mesh.material.opacity = 0.1;
            pipeData.mesh.material.emissiveIntensity = 0;
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