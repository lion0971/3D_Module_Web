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
let autoMoveSpeed = 0;
let prevTime = performance.now();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const collidableObjects = [];
const doorObjects = [];
const lightParticles = []; // 用於存放粒子系統以便在 animate 更新

// --- 1. 場景基礎設置 ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CONFIG.CAMERA.fov, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(CONFIG.CAMERA.startPos.x, CONFIG.CAMERA.startPos.y, CONFIG.CAMERA.startPos.z);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.5;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

let composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2),
    0.8,   // 提高強度讓粒子更有光暈感
    1.0,   
    0.1    // 降低閾值讓微弱的粒子也能觸發 Bloom
);
composer.addPass(bloomPass);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0px';
labelRenderer.domElement.style.pointerEvents = 'none';
document.body.appendChild(labelRenderer.domElement);

// --- 核心：體積粒子生成函式 ---
function createVolumetricLight(position, color) {
    const particleCount = 1000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const opacities = new Float32Array(particleCount);
    const speeds = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radiusFactor = Math.random();
        const y = -Math.random() * 4.0; // 往下延伸的高度
        
        const spread = THREE.MathUtils.mapLinear(y, 0, -4.0, 0.1, 1.8);
        const r = Math.sqrt(radiusFactor) * spread;

        positions[i * 3 + 0] = position.x + Math.cos(angle) * r;
        positions[i * 3 + 1] = position.y + y;
        positions[i * 3 + 2] = position.z + Math.sin(angle) * r;

        opacities[i] = Math.random();
        speeds[i] = 0.5 + Math.random();
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('opacity', new THREE.BufferAttribute(opacities, 1));
    geometry.setAttribute('speed', new THREE.BufferAttribute(speeds, 1));

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(color) }
        },
        vertexShader: `
            attribute float opacity;
            attribute float speed;
            varying float vOpacity;
            varying float vY;
            uniform float uTime;
            void main() {
                vOpacity = opacity;
                vY = position.y;
                vec3 pos = position;
                pos.y += sin(uTime * speed * 0.5) * 0.05; // 呼吸浮動
                vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                gl_PointSize = (15.0 + (vY * -1.5)) * (300.0 / -mvPosition.z);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            varying float vOpacity;
            varying float vY;
            void main() {
                float dist = length(gl_PointCoord - vec2(0.5));
                if (dist > 0.5) discard;
                float soft = smoothstep(0.5, 0.2, dist);
                // 垂直淡出：頂部與底部羽化
                float vFade = smoothstep(0.0, -0.6, vY) * smoothstep(-4.0, -3.0, vY);
                gl_FragColor = vec4(uColor, vOpacity * soft * vFade * 0.25);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    return new THREE.Points(geometry, material);
}

// --- 2. 燈光與環境 ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.03);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 0.5);
sunLight.position.set(15, 15, 0);
scene.add(sunLight);

const manager = new THREE.LoadingManager();
new EXRLoader(manager).load(CONFIG.MODELS.HDRI, (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdr;
    scene.environmentIntensity = 0.5;
});

// --- 3. 控制器 ---
const controls = new PointerLockControls(camera, renderer.domElement);
renderer.domElement.addEventListener('click', () => controls.lock());
scene.add(controls.getObject());

camera.lookAt(CONFIG.CAMERA.lookAtPos.x, CONFIG.CAMERA.lookAtPos.y, CONFIG.CAMERA.lookAtPos.z);

const onKeyDown = (e) => {
    switch (e.code) {
        case 'KeyW': moveForward = true; break;
        case 'KeyA': moveLeft = true; break;
        case 'KeyS': moveBackward = true; break;
        case 'KeyD': moveRight = true; break;
    }
};
const onKeyUp = (e) => {
    switch (e.code) {
        case 'KeyW': moveForward = false; break;
        case 'KeyA': moveLeft = false; break;
        case 'KeyS': moveBackward = false; break;
        case 'KeyD': moveRight = false; break;
    }
};
document.addEventListener('keydown', onKeyDown);
document.addEventListener('keyup', onKeyUp);

// --- 4. 模型載入 ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader(manager);
loader.setDRACOLoader(dracoLoader);

// 載入建築
loader.load(CONFIG.MODELS.BUILDING, (gltf) => {
    gltf.scene.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const name = mesh.name.toLowerCase();

        // 偵測燈泡位置並生成粒子光束
        if (name.includes("bulb")) {
            const worldPosition = new THREE.Vector3();
            mesh.getWorldPosition(worldPosition);
            
            const light = new THREE.PointLight(0xfff3d4, 0.2, 30);
            light.position.copy(worldPosition);
            scene.add(light);

            // 生成體積光粒子
            const vLight = createVolumetricLight(worldPosition, 0xfff3d4);
            lightParticles.push(vLight);
            scene.add(vLight);

            if (mesh.material) {
                mesh.material.emissive = new THREE.Color(0xfff3d4);
                mesh.material.emissiveIntensity = 2.5;
            }
        }

        // 移除原本的 Cone 幾何體渲染 (或將其設為不可見)
        if (name.includes("cone")) {
            mesh.visible = false; 
        }

        if (name.includes("wall") || (name.includes("door") && !name.includes("locker"))) {
            if (!name.includes("floor") && !name.includes("ground")) {
                collidableObjects.push(mesh);
            }
        }
        if (name.includes("door")) {
            doorObjects.push(mesh);
            mesh.userData.isOpen = false;
        }
        if (CONFIG.ROOM_DATA[mesh.name]) {
            const div = document.createElement('div');
            div.className = 'door-label';
            div.textContent = CONFIG.ROOM_DATA[mesh.name];
            const label = new CSS2DObject(div);
            label.position.set(0, 2.2, 0);
            mesh.add(label);
        }
    });
    scene.add(gltf.scene);
});

// 載入植物 (省略部分重複邏輯保持簡潔)
loader.load(CONFIG.MODELS.PLANT, (gltf) => {
    scene.add(gltf.scene);
});

// 5. 渲染與動畫
function animate() {
    requestAnimationFrame(animate);
    const time = performance.now() / 1000;
    const delta = Math.min(time - prevTime, 0.1);

    // 更新所有粒子系統的時間
    lightParticles.forEach(p => {
        if (p.material.uniforms) p.material.uniforms.uTime.value = time;
    });

    if (controls.isLocked) {
        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;
        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize();

        const checkWall = (dirVector) => {
            const worldDir = dirVector.clone().applyQuaternion(camera.quaternion);
            worldDir.y = 0; worldDir.normalize();
            const colRaycaster = new THREE.Raycaster(camera.position.clone().add(new THREE.Vector3(0,-0.8,0)), worldDir, 0, 0.6);
            return colRaycaster.intersectObjects(collidableObjects).length > 0;
        };

        if ((moveForward || moveBackward) && !checkWall(moveForward ? new THREE.Vector3(0,0,-1) : new THREE.Vector3(0,0,1))) {
            velocity.z -= direction.z * 40.0 * delta;
        }
        if ((moveLeft || moveRight) && !checkWall(moveLeft ? new THREE.Vector3(-1,0,0) : new THREE.Vector3(1,0,0))) {
            velocity.x -= direction.x * 40.0 * delta;
        }
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
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});