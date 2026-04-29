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
const interactiveDoors = []; // 存放可點擊的門

// --- 1. 場景基礎設置 ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CONFIG.CAMERA.fov, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(CONFIG.CAMERA.startPos.x, CONFIG.CAMERA.startPos.y, CONFIG.CAMERA.startPos.z);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// --- 2. 後處理 (Bloom) ---
let composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.12,  // 強度調低，保持背景乾淨
    0.4,
    0.85
);
composer.addPass(bloomPass);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0px';
labelRenderer.domElement.style.pointerEvents = 'none';
document.body.appendChild(labelRenderer.domElement);

// --- 3. 粒子生成函式 (修復 Shader 報錯與造型) ---
function createVolumetricLight(color) {
    const particleCount = 500;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const opacities = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radiusFactor = Math.random();
        const y = -Math.random() * 2.5; 

        // 圓錐造型微調
        const spread = 0.01 + ((-y / 2.5) * 0.3);
        const r = Math.sqrt(radiusFactor) * spread;

        positions[i * 3 + 0] = Math.cos(angle) * r;
        positions[i * 3 + 1] = y - 0.05;
        positions[i * 3 + 2] = Math.sin(angle) * r;
        opacities[i] = 0.3 + Math.random() * 0.7;
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
                // 加入微小晃動
                pos.x += sin(uTime * 0.5 + vY) * 0.01;
                vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                
                // 計算點的大小，並隨深度衰減
                gl_PointSize = (2.0 + (-vY * 1.5)) * (300.0 / length(mvPosition.xyz));
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uTime;
            varying float vOpacity;
            varying float vY;
            void main() {
                // 畫圓形粒子
                float d = length(gl_PointCoord - vec2(0.5));
                if (d > 0.5) discard;
                
                float mask = smoothstep(0.5, 0.2, d);
                float topFade = smoothstep(0.0, -0.3, vY);
                float bottomFade = smoothstep(-2.5, -1.8, vY);
                
                // 💡 調整亮度，避免死白
                gl_FragColor = vec4(uColor, vOpacity * mask * topFade * bottomFade * 0.005);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    return new THREE.Points(geometry, material);
}

// --- 4. 載入管理 (修復 manager is not defined) ---
const manager = new THREE.LoadingManager();
const loadingScreen = document.getElementById('loading-screen');

manager.onLoad = () => {
    console.log("所有資源載入完成");
    if (loadingScreen) {
        loadingScreen.classList.add('fade-out');
        setTimeout(() => { loadingScreen.style.display = 'none'; }, 1000);
    }
};

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader(manager);
loader.setDRACOLoader(dracoLoader);

// 環境光與 HDRI
scene.add(new THREE.AmbientLight(0xffffff, 0.05));
new EXRLoader(manager).load(CONFIG.MODELS.HDRI, (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdr;
});

// --- 5. 互動邏輯 (修復開門) ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function checkDoorInteraction() {
    if (controls.isLocked) {
        raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    } else {
        raycaster.setFromCamera(mouse, camera);
    }

    const intersects = raycaster.intersectObjects(interactiveDoors);
    if (intersects.length > 0) {
        const door = intersects[0].object;
        console.log("嘗試開啟:", door.name);
        
        // 簡易旋轉門示範
        if (door.rotation.y === 0) {
            door.rotation.y = Math.PI / 2;
        } else {
            door.rotation.y = 0;
        }
    }
}

// 載入建築
loader.load(CONFIG.MODELS.BUILDING, (gltf) => {
    scene.add(gltf.scene);

    gltf.scene.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const name = mesh.name.toLowerCase();

        // 燈泡處理
        if (name.includes("bulb")) {
            const vLight = createVolumetricLight(0xfff3d4);
            mesh.add(vLight);
            lightParticles.push(vLight);
            if (mesh.material) {
                mesh.material.emissive = new THREE.Color(0xfff3d4);
                mesh.material.emissiveIntensity = 0.3;
            }
        }

        // 門處理
        if (name.includes("door")) {
            interactiveDoors.push(mesh);
        }

        // 碰撞物
        if (name.includes("wall") || (name.includes("door") && !name.includes("locker"))) {
            collidableObjects.push(mesh);
        }
    });
});

// --- 6. 控制與事件監聽 ---
const controls = new PointerLockControls(camera, renderer.domElement);

renderer.domElement.addEventListener('click', () => {
    if (controls.isLocked) {
        checkDoorInteraction();
    } else {
        controls.lock();
    }
});

window.addEventListener('mousemove', (event) => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
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
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});