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

const raycaster = new THREE.Raycaster();
const interactiveDevices = [];
const flowingPipes = new Map();
let isXRayMode = false;

const activeTimers = {
    faucet: { startTime: null, alerted: false },
    shower: { startTime: null, alerted: false }
};

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

// --- 2. 後處理 (Bloom) ---
let composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.2, 0.5, 0.85
);
composer.addPass(bloomPass);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0px';
labelRenderer.domElement.style.pointerEvents = 'none';
document.body.appendChild(labelRenderer.domElement);

// --- 3. [回補] 氛圍光與材質函式 ---

// 生成錐形氛圍光 (光束效果)
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

// --- 4. 載入管理 ---
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
const exrLoader = new EXRLoader(manager);

scene.add(new THREE.AmbientLight(0xffffff, 0.005));

exrLoader.load(CONFIG.MODELS.HDRI, (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdr;
});

loader.load(CONFIG.MODELS.BUILDING, (gltf) => {
    scene.add(gltf.scene);
    gltf.scene.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const name = mesh.name.toLowerCase();

        // [回補] 燈泡與光束邏輯
        if (name.includes("bulb")) {
            if (mesh.material) {
                mesh.material.emissive = new THREE.Color(0xffaa44);
                mesh.material.emissiveIntensity = 10;
                if (mesh.material.map) mesh.material.color.setHex(0x444444);
            }
            // 加入光束
            const vConeLight = createConeVolumetricLight(0xffaa44);
            vConeLight.position.y = 0.2;
            mesh.add(vConeLight);
            // 加入實體光源
            const spotLight = new THREE.SpotLight(0xffaa44, 3, 5, Math.PI / 3.5, 0.6, 2);
            spotLight.position.set(0, 0, 0);
            mesh.add(spotLight);
            mesh.add(spotLight.target);
            spotLight.target.position.set(0, -10, 0);
        }

        // 管路處理
        if (name === "measure_total" || name === "measure_tank" || name === "measure_bath") {
            mesh.material = new THREE.MeshStandardMaterial({
                color: 0x00ffff,
                transparent: true,
                opacity: 0.05,
                emissive: 0x00ffff,
                emissiveIntensity: 0,
                side: THREE.DoubleSide
            });
            flowingPipes.set(name, { mesh: mesh, active: false });
        }

        // 設備與碰撞
        if (name === "faucet" || name === "shower") interactiveDevices.push(mesh);
        if (name.includes("wall") || name.includes("floor")) collidableObjects.push(mesh);
    });
});

// --- 5. UI 與互動邏輯 ---
const uiContainer = document.createElement('div');
uiContainer.style.position = 'absolute';
uiContainer.style.top = '20px';
uiContainer.style.left = '20px';
uiContainer.style.zIndex = '100';
document.body.appendChild(uiContainer);

const xrayBtn = document.createElement('button');
xrayBtn.innerText = '開啟管路透視模式';
xrayBtn.style.padding = '10px 20px';
xrayBtn.style.cursor = 'pointer';
xrayBtn.style.background = 'rgba(0, 255, 255, 0.3)';
xrayBtn.style.color = 'white';
xrayBtn.style.border = '1px solid cyan';
xrayBtn.onclick = () => {
    isXRayMode = !isXRayMode;
    xrayBtn.innerText = isXRayMode ? '關閉管路透視模式' : '開啟管路透視模式';
    toggleXRayMode(isXRayMode);
};
uiContainer.appendChild(xrayBtn);

function toggleXRayMode(enable) {
    scene.traverse((obj) => {
        if (obj.isMesh) {
            const name = obj.name.toLowerCase();
            const isPipe = name.includes("measure") || name.includes("pipe");
            const isDevice = interactiveDevices.includes(obj) || name.includes("bulb"); // 燈泡不透明

            if (!isPipe && !isDevice) {
                obj.material.transparent = true;
                obj.material.opacity = enable ? 0.15 : 1.0;
                obj.material.depthWrite = !enable;
            }
        }
    });
}

const controls = new PointerLockControls(camera, renderer.domElement);
renderer.domElement.addEventListener('click', () => {
    if (!controls.isLocked) {
        controls.lock();
    } else {
        raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
        const intersects = raycaster.intersectObjects(interactiveDevices);
        if (intersects.length > 0) {
            const targetName = intersects[0].object.name.toLowerCase();
            const pipeKey = targetName === 'faucet' ? 'measure_tank' : 'measure_bath';
            const pipe = flowingPipes.get(pipeKey);
            if (pipe) {
                pipe.active = !pipe.active;
                if (pipe.active) {
                    activeTimers[targetName].startTime = Date.now();
                    activeTimers[targetName].alerted = false;
                } else {
                    activeTimers[targetName].startTime = null;
                }
            }
            let anyActive = false;
            flowingPipes.forEach(p => { if (p.active) anyActive = true; });
            const total = flowingPipes.get('measure_total');
            if (total) total.active = anyActive;
        }
    }
});

// --- 6. 動畫迴圈 ---
function animate() {
    requestAnimationFrame(animate);
    const time = performance.now() / 1000;
    const delta = Math.min(time - prevTime, 0.1);

    // 在 animate() 內的流動動畫
    flowingPipes.forEach((pipeData) => {
        if (pipeData.active) {
            pipeData.mesh.material.opacity = 0.8;
            // 模擬水流波動：縮短週期讓閃爍感更像流動
            const flowSpeed = time * 12;
            pipeData.mesh.material.emissiveIntensity = 0.5 + Math.sin(flowSpeed) * 0.3;

            // 如果你有貼圖，可以讓貼圖位移
            // if (pipeData.mesh.material.map) pipeData.mesh.material.map.offset.y -= 0.02;
        }
    });

    // 在 animate() 內動態更新文字
for (const key in activeTimers) {
    const timer = activeTimers[key];
    const pipe = flowingPipes.get(key === 'faucet' ? 'measure_tank' : 'measure_bath');
    
    if (timer.startTime) {
        const elapsed = Math.floor((Date.now() - timer.startTime) / 1000);
        // 更新掛在模型上的文字
        if (pipe && pipe.timerUI) {
            pipe.timerUI.innerText = `已流水: ${elapsed}s`;
            pipe.timerUI.style.display = 'block';
        }
    } else if (pipe && pipe.timerUI) {
        pipe.timerUI.style.display = 'none';
    }
}

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

// --- 7. 視窗調整 ---
window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    labelRenderer.setSize(w, h);
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

// --- 視窗縮放監聽 (更新版) ---
window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;

    // 1. 更新攝影機比例
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    // 2. 更新主渲染器尺寸
    renderer.setSize(w, h);

    // 3. 更新後處理 (Bloom) 渲染器尺寸
    if (composer) {
        composer.setSize(w, h);
    }

    // 4. 更新標籤渲染器尺寸 (確保文字標籤不跑位)
    if (labelRenderer) {
        labelRenderer.setSize(w, h);
    }
});