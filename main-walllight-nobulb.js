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
// --- 3. 修正後的圓錐氛圍光體 (使用 ConeGeometry 替代粒子) ---
function createConeVolumetricLight(color) {
    const h = 2.5; // 圓錐高度
    const baseRadius = 0.45; // 圓錐底部半徑 (決定圓錐開展程度)

    // 創建一個向下的圓錐體。
    // Tube: true 讓它呈現空心管狀，底部不封口。
    const geometry = new THREE.ConeGeometry(baseRadius, h, 32, 1, true);

    // Shader 材質，實現頂部柔和漸隱，邊緣柔和的效果
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(color) },
            uHeight: { value: h } // 傳遞圓錐高度給 Shader
        },
        vertexShader: `
            varying float vY;
            void main() {
                vY = position.y; // 傳遞局部 Y 坐標
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uHeight;
            varying float vY;
            void main() {
                // 核心邏輯：頂部 (y = uHeight/2) 最暗，底部 (y = -uHeight/2) 最暗。
                // 確保與燈座接觸點 (尖端) 是柔和的。
                
                // 1. 垂直過渡：讓光束從頂部開始慢慢變亮，底部慢慢變暗。
                float verticalFade = smoothstep(uHeight/2.0, uHeight/2.0 - 0.2, vY) * // 頂部極尖端柔和
                                    smoothstep(-uHeight/2.0, -uHeight/2.0 + 1.0, vY); // 底部漸隱
                
                // 2. [進階] 圓錐邊緣柔化 (如果需要可以添加)
                // 此處省略，僅使用垂直過渡已能解決切邊問題。

                // 3. Alpha 控制：使用較低的基礎 Alpha
                float alpha = 0.1 * verticalFade;
                
                gl_FragColor = vec4(uColor, alpha);
            }
        `,
        transparent: true, // 必須開啟透明
        depthWrite: false, // 必須關閉深度寫入，避免硬切邊
        blending: THREE.AdditiveBlending, // 加法混合，保持光束的靈動感
        side: THREE.DoubleSide // 雙面渲染，確保從內部也能看到
    });

    const coneMesh = new THREE.Mesh(geometry, material);

    // ConeGeometry 的坐標原點在體積中心。將其下移，使其尖端與模型原點重合。
    coneMesh.position.y = -h / 2;

    return coneMesh;
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
// --- 5. 互動與模型載入 (使用 Cone Volumetric Light) ---
loader.load(CONFIG.MODELS.BUILDING, (gltf) => {
    scene.add(gltf.scene);
    gltf.scene.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const name = mesh.name.toLowerCase();

        if (name.includes("bulb")) {
            console.log("找到燈泡/燈座模型:", mesh.name);

            // 1. 關閉模型自發光 (保留原本的修正)
            if (mesh.material) {
                mesh.material.emissive = new THREE.Color(0x000000); 
                mesh.material.emissiveIntensity = 0; 
                if (mesh.material.map) mesh.material.color.setHex(0x333333); 
            }

            // 2. [新的氛圍光體] 柔和圓錐體模型
            const vConeLight = createConeVolumetricLight(0xfff5d7);
            // --- 💡 關鍵對齊處 ---
            // 需要微調 y 軸，讓圓錐模型的頂端隱藏在燈座模型「內部」。
            // 原本粒子 y=-0.2，這裡需要反過來向上偏移。建議設為 y=0.1 到 0.2。
            // 這會消除 image_3.png 中那個生硬的切邊線。
            vConeLight.position.y = 0.15; // 從燈座原點向上偏移 0.15
            mesh.add(vConeLight);
            
            // 注意：這裡不需要 push 到 lightParticles 數組了，因為 Cone 不再使用 uTime。
            // 如果你的 animate 函式裡有 lightParticles.forEach，請將其註解或刪除。

            // 3. [保留] 實體 SpotLight (地面投影)
            const spotLight = new THREE.SpotLight(0xfff5d7, 2.5, 12, Math.PI / 4, 0.5, 2);
            spotLight.position.set(0, 0, 0); 
            mesh.add(spotLight);
            mesh.add(spotLight.target);
            spotLight.target.position.set(0, -10, 0); 
        }

        // ... 後續門與碰撞物邏輯不變 ...
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