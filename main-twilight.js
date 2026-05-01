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
let movingLightGroup = []; 

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

// --- 2. 後處理 ---
let composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.1, 0.9);
composer.addPass(bloomPass);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0px';
labelRenderer.domElement.style.pointerEvents = 'none';
document.body.appendChild(labelRenderer.domElement);

// --- 3. 資源載入管理 (修正卡死問題) ---
const loadingScreen = document.getElementById('loading-screen');

function hideLoadingScreen() {
    if (loadingScreen) {
        console.log("所有資源載入完成，關閉載入畫面");
        loadingScreen.classList.add('fade-out');
        setTimeout(() => { loadingScreen.style.display = 'none'; }, 1000);
    }
}

const manager = new THREE.LoadingManager();

// 當所有資源載入完成時
manager.onLoad = () => {
    hideLoadingScreen();
};

// 監控進度 (可選，方便除錯)
manager.onProgress = (url, itemsLoaded, itemsTotal) => {
    console.log(`載入中: ${Math.round(itemsLoaded / itemsTotal * 100)}% (${url})`);
};

// 如果有任何資源載入出錯，也要讓畫面能進去，避免卡死
manager.onError = (url) => {
    console.error('載入出錯的檔案:', url);
    // 即使出錯，5秒後也強制進入，避免使用者一直看著黑畫面
    setTimeout(hideLoadingScreen, 2000); 
};

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader(manager);
loader.setDRACOLoader(dracoLoader);

// --- 4. 環境與模型載入 ---
scene.add(new THREE.AmbientLight(0xffffff, 0.05));

new EXRLoader(manager).load(CONFIG.MODELS.HDRI, (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdr;
});

loader.load(CONFIG.MODELS.BUILDING, (gltf) => {
    scene.add(gltf.scene);
    gltf.scene.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const name = mesh.name.toLowerCase();

        if (name.includes("bulb")) {
            const lightColor = 0xfff5d7;
            mesh.material = new THREE.MeshStandardMaterial({
                color: 0xffe28a,
                emissive: new THREE.Color(lightColor),
                emissiveIntensity: 1.5,
                toneMapped: true
            });

            // 圓錐光束
            const vCone = createConeVolumetricLight(lightColor);
            vCone.position.set(0, 0.1, 0); 
            mesh.add(vCone);

            // 聚光燈
            const spotLight = new THREE.SpotLight(lightColor, 3, 12, Math.PI / 6, 0.5, 2);
            spotLight.position.set(0, 0.1, 0); 
            mesh.add(spotLight);
            
            const targetObject = new THREE.Object3D();
            targetObject.position.set(0, -1, 0); 
            mesh.add(targetObject);
            spotLight.target = targetObject;

            movingLightGroup.push({ cone: vCone, light: spotLight });
        }
    });
}, undefined, (error) => {
    console.error("模型載入失敗:", error);
    hideLoadingScreen(); // 失敗也要關閉畫面
});

// --- 5. 圓錐生成函式 ---
function createConeVolumetricLight(color) {
    const h = 2.5; 
    const baseRadius = 0.35; 
    const geometry = new THREE.ConeGeometry(baseRadius, h, 32, 1, true);
    geometry.translate(0, -h / 2, 0); 

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(color) },
            uHeight: { value: h }
        },
        vertexShader: `
            varying float vY;
            void main() {
                vY = position.y; 
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uHeight;
            varying float vY;
            void main() {
                float verticalFade = smoothstep(0.0, -0.15, vY) * 
                                   smoothstep(-uHeight, -uHeight + 0.8, vY);
                float alpha = 0.35 * verticalFade; 
                gl_FragColor = vec4(uColor, alpha);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
    });
    return new THREE.Mesh(geometry, material);
}

// --- 6. 控制與主迴圈 ---
const controls = new PointerLockControls(camera, renderer.domElement);
renderer.domElement.addEventListener('click', () => { if (!controls.isLocked) controls.lock(); });

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

    movingLightGroup.forEach((group) => {
        const newY = 0.1 + Math.sin(time * 1.5) * 0.05;
        group.cone.position.y = newY;
        group.light.position.y = newY;
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
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
});