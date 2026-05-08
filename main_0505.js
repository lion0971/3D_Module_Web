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

// --- 1. 場景基礎設置 ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CONFIG.CAMERA.fov, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(CONFIG.CAMERA.startPos.x, CONFIG.CAMERA.startPos.y, CONFIG.CAMERA.startPos.z);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85; // 稍微調高，讓暖色調更亮眼
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// --- 2. 後處理 (Bloom) ---
let composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.2,   // 強度：調降以避免背景發光
    0.5,   // 半徑
    0.85   // 閾值：只讓光束中心和燈泡微發光
);
composer.addPass(bloomPass);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0px';
labelRenderer.domElement.style.pointerEvents = 'none';
document.body.appendChild(labelRenderer.domElement);

// --- 3. 圓錐氛圍光體生成函式 ---
function createConeVolumetricLight(color) {
    const h = 3.2; // 圓錐高度
    const baseRadius = 0.55; // 圓錐底部半徑
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
                // 1. 垂直漸隱 (解決頂部硬切邊與底部消失)
                float topFade = smoothstep(uHeight/2.0, uHeight/2.0 - 0.6, vY); 
                float bottomFade = smoothstep(-uHeight/2.0, -uHeight/2.0 + 1.8, vY);
                
                // 2. 邊緣漸隱 (Fresnel Effect): 讓光束側邊看起來更柔和，不像實體
                float dotProduct = dot(vNormal, vViewDir);
                float rimFade = smoothstep(0.0, 0.4, abs(dotProduct));

                float alpha = 0.22 * topFade * bottomFade * rimFade;
                gl_FragColor = vec4(uColor, alpha);
            }
        `,
        transparent: true,
        depthWrite: false, // 關鍵：防止光束遮擋背景導致黑邊或硬切
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
    });

    const coneMesh = new THREE.Mesh(geometry, material);
    coneMesh.position.y = -h / 2; // 將圓錐頂點對齊父物件中心
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

// 降低環境光，讓室內呈現傍晚/夜晚感，強化燈光效果
scene.add(new THREE.AmbientLight(0xffffff, 0.005));

new EXRLoader(manager).load(CONFIG.MODELS.HDRI, (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdr;
});

// --- 5. 載入模型與光束應用 ---
loader.load(CONFIG.MODELS.BUILDING, (gltf) => {
    scene.add(gltf.scene);
    gltf.scene.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const name = mesh.name.toLowerCase();

        if (name.includes("bulb")) {
            // 關閉燈泡模型本身的生硬自發光
            if (mesh.material) {
                mesh.material.emissive = new THREE.Color(0xffaa44);
                mesh.material.emissiveIntensity = 10;
                if (mesh.material.map) mesh.material.color.setHex(0x444444); 
            }

            // 添加圓錐光束
            const vConeLight = createConeVolumetricLight(0xffaa44); // 使用暖橘色
            vConeLight.position.y = 0.2; // 稍微向上沒入燈罩內部
            mesh.add(vConeLight);

            // 實體 SpotLight (地面暖光投影)
            const spotLight = new THREE.SpotLight(0xffaa44,3, 5, Math.PI / 3.5, 0.6, 2);//燈光的強度，光源照射的最大範圍（距離），光束的分散角度（弧度），半影區（邊緣柔和度)0 代表光圈邊緣非常銳利（像剪裁出來的）；1.0 代表光圈從中心到邊緣會非常平滑地過度
            spotLight.position.set(0, 0, 0);
            mesh.add(spotLight);
            mesh.add(spotLight.target);
            spotLight.target.position.set(0, -10, 0);
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