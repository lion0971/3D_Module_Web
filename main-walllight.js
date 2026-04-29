import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer';
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
const lightParticles = [];
const interactiveDoors = []; 

// --- 1. 場景基礎設置 ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CONFIG.CAMERA.fov, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(CONFIG.CAMERA.startPos.x, CONFIG.CAMERA.startPos.y, CONFIG.CAMERA.startPos.z);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.8;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// --- 2. 後處理 (Bloom) ---
// 修正處：調整為合理的氛圍數值，不再使用 100 這種無效值
let composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.2,   // 強度 (Strength): 0.5 - 1.5 較合適
    0.3,   // 半徑 (Radius): 影響發光散開的範圍
    0.9   // 閾值 (Threshold): 越低代表越容易發光
);
composer.addPass(bloomPass);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0px';
labelRenderer.domElement.style.pointerEvents = 'none';
document.body.appendChild(labelRenderer.domElement);

// --- 3. 圓錐粒子生成函式 ---
function createVolumetricLight(color) {
    const particleCount = 800; 
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const opacities = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
        const h = 3.0; // 圓錐高度
        const y = -Math.random() * h; 
        const angle = Math.random() * Math.PI * 2;
        
        // 圓錐半徑公式：隨 y 增加而線性擴大
        // 頂端 (y=0) 半徑趨近 0，底部 (y=-3) 半徑最大
        const spread = 0.5; 
        const radius = (-y / h) * spread * Math.sqrt(Math.random());

        positions[i * 3 + 0] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = y - 0.1; // 稍微下移，避開燈罩頂部
        positions[i * 3 + 2] = Math.sin(angle) * radius;
        
        opacities[i] = 0.2 + Math.random() * 0.8;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1));

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0.0 },
            uColor: { value: new THREE.Color(color) }
        },
        vertexShader: `
            attribute float opacity;
            varying float vOpacity;
            varying float vY;
            uniform float uTime;
            void main() {
                vOpacity = opacity;
                vY = position.y;
                vec3 pos = position;
                
                // 微小隨機晃動
                pos.x += sin(uTime * 0.5 + vY) * 0.015;
                pos.z += cos(uTime * 0.5 + vY) * 0.015;

                vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                // 距離越遠，粒子視覺尺寸越大
                gl_PointSize = (1.2 + (-vY * 0.8)) * (300.0 / length(mvPosition.xyz));
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uTime;
            varying float vOpacity;
            varying float vY;
            void main() {
                float d = length(gl_PointCoord - vec2(0.5));
                if (d > 0.5) discard;
                
                float mask = smoothstep(0.5, 0.2, d);
                
                // 垂直衰減：頂部漸強，底部漸弱
                float topFade = smoothstep(0.0, -0.3, vY);
                float bottomFade = smoothstep(-3.0, -1.0, vY);
                
                // Alpha 控制：0.15 是關鍵，避免多粒子重疊變成死白
                float alpha = vOpacity * mask * topFade * bottomFade * 0.03;
                
                gl_FragColor = vec4(uColor, alpha);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    return new THREE.Points(geometry, material);
}

// --- 4. 載入與資源管理 ---
const manager = new THREE.LoadingManager();
const loadingScreen = document.getElementById('loading-screen');
manager.onLoad = () => {
    if (loadingScreen) {
        loadingScreen.classList.add('fade-out');
        setTimeout(() => { loadingScreen.style.display = 'none'; }, 1000);
    }
};

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader(manager);
loader.setDRACOLoader(dracoLoader);

// 環境光
scene.add(new THREE.AmbientLight(0xffffff, 0.02));
new EXRLoader(manager).load(CONFIG.MODELS.HDRI, (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdr;
});

// --- 5. 互動邏輯 ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function checkDoorInteraction() {
    raycaster.setFromCamera(controls.isLocked ? new THREE.Vector2(0, 0) : mouse, camera);
    const intersects = raycaster.intersectObjects(interactiveDoors);
    if (intersects.length > 0) {
        const door = intersects[0].object;
        door.rotation.y = (door.rotation.y === 0) ? Math.PI / 2 : 0;
    }
}

// 載入模型並應用燈光
loader.load(CONFIG.MODELS.BUILDING, (gltf) => {
    scene.add(gltf.scene);
    gltf.scene.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const name = mesh.name.toLowerCase();

        if (name.includes("bulb")) {
            // 圓錐粒子光束
            const vLight = createVolumetricLight(0xfff5d7);
            mesh.add(vLight);
            lightParticles.push(vLight);

            // 實體 SpotLight (地面投影)
            const spotLight = new THREE.SpotLight(0xfff5d7, 2.5, 12, Math.PI / 4, 0.5, 2);
            spotLight.position.set(0, 0, 0);
            mesh.add(spotLight);
            mesh.add(spotLight.target);
            spotLight.target.position.set(0, -10, 0);

            if (mesh.material) {
                mesh.material.emissive = new THREE.Color(0xfff5d7);
                mesh.material.emissiveIntensity = 1.5;
            }
        }

        if (name.includes("door")) interactiveDoors.push(mesh);
        if (name.includes("wall") || (name.includes("door") && !name.includes("locker"))) {
            collidableObjects.push(mesh);
        }
    });
});

// --- 6. 控制與主迴圈 ---
const controls = new PointerLockControls(camera, renderer.domElement);
renderer.domElement.addEventListener('click', () => {
    if (controls.isLocked) checkDoorInteraction(); else controls.lock();
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

    lightParticles.forEach(p => {
        if (p.material.uniforms) p.material.uniforms.uTime.value = time;
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