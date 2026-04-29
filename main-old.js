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
const interactiveDoors = [];

// --- 1. 場景基礎設置 ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CONFIG.CAMERA.fov, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(CONFIG.CAMERA.startPos.x, CONFIG.CAMERA.startPos.y, CONFIG.CAMERA.startPos.z);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// --- 2. 後處理 (Bloom) ---
let composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

// 調整 Bloom 參數以獲得圖片中那種燈泡周圍的柔和光暈
const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.4,   // 強度 (Strength)
    0.3,   // 半徑 (Radius)
    0.85   // 閾值 (Threshold): 只有高自發光的燈泡會產生光暈
);
composer.addPass(bloomPass);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0px';
labelRenderer.domElement.style.pointerEvents = 'none';
document.body.appendChild(labelRenderer.domElement);

// --- 3. 優化後的圓錐氛圍光體生成函式 ---
function createConeVolumetricLight(color) {
    const h = 3.0;
    const baseRadius = 0.6;
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
                // 1. 垂直過渡：解決切邊硬傷，頂部接觸點設為完全透明
                float topFade = smoothstep(uHeight/2.0, uHeight/2.0 - 0.4, vY); 
                float bottomFade = smoothstep(-uHeight/2.0, -uHeight/2.0 + 1.5, vY);
                
                // 2. 邊緣柔化 (Fresnel)：讓側面看起來透明，正中心較亮
                float dotProduct = dot(vNormal, vViewDir);
                float rimFade = smoothstep(0.0, 0.8, abs(dotProduct));

                float alpha = 0.12 * topFade * bottomFade * rimFade;
                gl_FragColor = vec4(uColor, alpha);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
    });

    const coneMesh = new THREE.Mesh(geometry, material);
    coneMesh.position.y = -h / 2; // 將尖端對齊模型中心
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

// 降低環境光，創造夜晚高級感
scene.add(new THREE.AmbientLight(0xffffff, 0.005));
new EXRLoader(manager).load(CONFIG.MODELS.HDRI, (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdr;
});

// --- 5. 載入模型並應用燈光 ---
loader.load(CONFIG.MODELS.BUILDING, (gltf) => {
    scene.add(gltf.scene);
    gltf.scene.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const name = mesh.name.toLowerCase();

        if (name.includes("bulb")) {
            const lightColor = 0xfff5d7; // 統一暖白光

            // 1. 修改燈泡材質為強大的自發光實體
            if (mesh.material) {
                mesh.material = new THREE.MeshStandardMaterial({
                    color: 0x666666,        // [調暗] 基礎顏色，避免本體過白
                    emissive: new THREE.Color(lightColor),
                    emissiveIntensity: 5.0, // [降低] 從 15~20 降到 5.0，配合 Bloom 的新參數
                    toneMapped: true        // [改回 true] 讓它受曝光度控制，避免直接爆白
                });
            }

            // 2. 氛圍圓錐光束
            const vConeLight = createConeVolumetricLight(lightColor);
            vConeLight.position.y = 0.2; // 關鍵：向上偏移，讓頂端隱藏在燈罩內
            mesh.add(vConeLight);

            // 3. 實體 SpotLight 投影
            const spotLight = new THREE.SpotLight(lightColor, 8, 15, Math.PI / 3.5, 0.5, 2);
            spotLight.position.set(0, 0, 0);
            mesh.add(spotLight);
            mesh.add(spotLight.target);
            spotLight.target.position.set(0, -10, 0);
        }

        if (name.includes("door")) interactiveDoors.push(mesh);
    });
});

// --- 6. 控制與主迴圈 ---
const controls = new PointerLockControls(camera, renderer.domElement);
renderer.domElement.addEventListener('click', () => {
    if (!controls.isLocked) controls.lock();
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