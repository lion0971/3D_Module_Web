import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer';
import { CONFIG } from './scene-config.js';

// --- 初始化變數 ---
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let autoMoveSpeed = 0;
let prevTime = performance.now();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const collidableObjects = [];
const doorObjects = [];

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

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0px';
labelRenderer.domElement.style.pointerEvents = 'none';
document.body.appendChild(labelRenderer.domElement);

// --- 2. 燈光與環境 ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.05);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 0.5);
sunLight.position.set(15, 15, 0);
scene.add(sunLight);

const manager = new THREE.LoadingManager();
const loaderBar = document.getElementById('loader-bar');
const loaderText = document.getElementById('loader-text');
const loadingScreen = document.getElementById('loading-screen');

new EXRLoader(manager).load(CONFIG.MODELS.HDRI, (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdr;
    scene.environmentIntensity = 4.5;
});

// --- 3. 控制器與輸入 ---
const controls = new PointerLockControls(camera, renderer.domElement);
renderer.domElement.addEventListener('click', () => controls.lock());
scene.add(controls.getObject());

// 修正關鍵：在這裡重新強制相機轉向
camera.lookAt(
    CONFIG.CAMERA.lookAtPos.x, 
    CONFIG.CAMERA.lookAtPos.y,
    CONFIG.CAMERA.lookAtPos.z
);

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

// --- 4. 模型載入邏輯 ---
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
const loader = new GLTFLoader(manager);
loader.setDRACOLoader(dracoLoader);

// 載入植物 (LOD 優化)
loader.load(CONFIG.MODELS.PLANT, (gltf) => {
    const modelScene = gltf.scene;
    const lod = new THREE.LOD();

    const createLODLevel = (namePrefix) => {
        const group = new THREE.Group();
        modelScene.traverse((node) => {
            if (node.isMesh && node.name.startsWith(namePrefix)) {
                const cloned = node.clone();
                cloned.material = node.material.clone();
                cloned.material.side = THREE.DoubleSide;

                if (node.name.toLowerCase().includes('leaf') || node.name.toLowerCase().includes('plant')) {
                    cloned.material.roughness = 0.6;
                }
                if (node.name.includes('Vase') || node.name.endsWith('_1')) {
                    cloned.material.metalness = 0.7;
                    cloned.material.roughness = 0.005;
                    cloned.material.flatShading = true;
                }
                group.add(cloned);
            }
        });
        return group;
    };

    lod.addLevel(createLODLevel('Plant_Turtle_LOD_High'), 0);
    lod.addLevel(createLODLevel('Plant_Turtle_LOD_Mid'), 15);
    lod.addLevel(createLODLevel('Plant_Turtle_LOD_Low'), 40);
    
    // 初始位置放置在鏡頭前
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    lod.position.copy(camera.position.clone().add(cameraDirection.multiplyScalar(5)));
    scene.add(lod);
});

// 載入建築物
loader.load(CONFIG.MODELS.BUILDING, (gltf) => {
    gltf.scene.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const name = mesh.name.toLowerCase();

        // 碰撞與門邏輯
        if (name.includes("wall") || (name.includes("door") && !name.includes("locker"))) {
            if (!name.includes("floor") && !name.includes("ground")) collidableObjects.push(mesh);
        }
        if (name.includes("door") || mesh.name.includes("門")) {
            doorObjects.push(mesh);
            mesh.userData.isOpen = false;
        }
        // 標籤邏輯
        if (CONFIG.ROOM_DATA[mesh.name]) {
            const div = document.createElement('div');
            div.className = 'door-label';
            div.textContent = CONFIG.ROOM_DATA[mesh.name];
            mesh.userData.labelDiv = div;
            mesh.userData.roomName = CONFIG.ROOM_DATA[mesh.name];
            const label = new CSS2DObject(div);
            label.position.set(0, 2.2, 0);
            mesh.add(label);
        }
    });
    scene.add(gltf.scene);
}, (xhr) => {
    const percent = Math.round((xhr.loaded / xhr.total) * 100);
    loaderBar.style.width = percent + '%';
    loaderText.innerText = percent >= 100 ? `優化數據中...` : `載入數位分身... ${percent}%`;
});

// --- 5. 互動與起動 ---
manager.onLoad = () => {
    setTimeout(() => {
        loadingScreen.classList.add('fade-out');
        autoMoveSpeed = 2.5;
        setTimeout(() => { loadingScreen.style.display = 'none'; }, 1200);
    }, 1000);
};

// 開門射線
const raycaster = new THREE.Raycaster();
document.addEventListener('click', () => {
    if (!controls.isLocked) return;
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = raycaster.intersectObjects(doorObjects);
    if (intersects.length > 0) {
        const door = intersects[0].object;
        door.userData.isOpen = !door.userData.isOpen;
        const openAngle = door.name === "out_door" ? -Math.PI / 2 : Math.PI / 2;
        door.rotation.y = door.userData.isOpen ? openAngle : 0;
    }
});

// --- 6. 動畫循環與更新 ---
function animate() {
    requestAnimationFrame(animate);
    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    // 更新 LOD
    scene.traverse(obj => { if (obj.isLOD) obj.update(camera); });

    // 自動進場效果
    if (autoMoveSpeed > 0.01) {
        controls.moveForward(autoMoveSpeed * delta);
        autoMoveSpeed *= Math.pow(0.95, delta * 60);
    }

    if (controls.isLocked) {
        // 摩擦力模擬
        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;
        
        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize();

        const checkWall = (dirVector) => {
            const colRaycaster = new THREE.Raycaster();
            const worldDir = dirVector.clone().applyQuaternion(camera.quaternion);
            worldDir.y = 0; worldDir.normalize();
            colRaycaster.set(camera.position.clone().setY(camera.position.y - 0.8), worldDir);
            colRaycaster.far = 0.6;
            return colRaycaster.intersectObjects(collidableObjects).length > 0;
        };

        if (moveForward || moveBackward) {
            const moveDir = moveForward ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 0, 1);
            if (!checkWall(moveDir)) velocity.z -= direction.z * 40.0 * delta;
        }
        if (moveLeft || moveRight) {
            const moveDir = moveLeft ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(1, 0, 0);
            if (!checkWall(moveDir)) velocity.x -= direction.x * 40.0 * delta;
        }

        controls.moveForward(-velocity.z * delta);
        controls.moveRight(-velocity.x * delta);
    }

    // 更新標籤透明度與虛擬溫度
    doorObjects.forEach(door => {
        if (door.userData.labelDiv) {
            const dist = camera.position.distanceTo(door.getWorldPosition(new THREE.Vector3()));
            door.userData.labelDiv.style.opacity = 1.0 - THREE.MathUtils.smoothstep(dist, 5, 15);
            if (Math.random() > 0.995) {
                const temp = (24 + Math.random()).toFixed(1);
                door.userData.labelDiv.textContent = `${door.userData.roomName} (${temp}°C)`;
            }
        }
    });

    prevTime = time;
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
}

animate();

// 視窗調整
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
});