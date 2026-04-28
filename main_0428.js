import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer';
import { CONFIG } from './scene-config.js';
//下方為燈光增加的合成器
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

// 1. 初始化合成器
let composer = new EffectComposer(renderer);

// 2. 加入基礎渲染路徑（把原本的場景畫出來）
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

// 3. 加入輝光路徑（UnrealBloomPass）
const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2),
    0.4,   // 強度 (Strength): 不要太強，否則會變一片白，0.8 左右最柔和
    1.2,   // 半徑 (Radius): 這是關鍵！調大一點（1.0 以上）讓光暈散開
    0.85    // 閾值 (Threshold): 調低一點，讓中等亮度的光束也能產生淡淡的光暈
);
composer.addPass(bloomPass);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0px';
labelRenderer.domElement.style.pointerEvents = 'none';
document.body.appendChild(labelRenderer.domElement);

// --- 2. 燈光與環境 ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.03);
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
    scene.environmentIntensity = 0.5;
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

        // 統一轉小寫，避免大小寫不匹配
        const name = mesh.name.toLowerCase();

        // --- 第一部分：處理燈泡與光源 ---
        if (name.includes("lightbulb")) {
            const worldPosition = new THREE.Vector3();
            mesh.getWorldPosition(worldPosition);

            // 建立點光源，加長距離至 30
            const light = new THREE.PointLight(0xfff3d4, 0.2, 30);
            light.position.copy(worldPosition);
            light.decay = 2.0;
            light.castShadow = false; // 取消陰影以節省效能
            scene.add(light);

            if (mesh.material) {
                mesh.material.emissive = new THREE.Color(0xfff3d4);
                mesh.material.emissiveIntensity = 2.5; // 超過 Threshold 確保 Bloom 效果
            }
        }

        if (name.includes("cone")) {
            const originalMaterial = mesh.material;
            // 💡 修改這行，改為抓取發光顏色 (Emissive Color)
            // 💡 專家級抓取法：優先抓取「發光色」，如果沒設，則抓取「基礎色」
            // .getHex() === 0 代表它是純黑 (未設定)
            const blenderColor = (originalMaterial.emissive && originalMaterial.emissive.getHex() !== 0x000000)
                ? originalMaterial.emissive
                : originalMaterial.color;
            const blenderOpacity = originalMaterial.opacity;

            const beamMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    beamColor: { value: blenderColor },
                    uOpacity: { value: blenderOpacity },
                    // 💡 調整後的菲涅耳參數：增加 power 讓邊緣更細膩
                    fresnelParams: {
                        value: new THREE.Vector3(0.05, 4.5, 1.2),
                        uTime: { value: 0 }
                    }
                },
                vertexShader: `
                varying vec3 vNormal;
                varying vec3 vViewPosition;
                varying float vY;
                void main() {
                vNormal = normalize(normalMatrix * normal);
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vViewPosition = -mvPosition.xyz;
                vY = position.y; 
                gl_Position = projectionMatrix * mvPosition;
            }
            `,
                fragmentShader: `
                uniform vec3 beamColor;
                uniform vec3 fresnelParams;
                uniform float uOpacity;
                uniform float uTime;

                varying vec3 vNormal;
                varying vec3 vViewPosition;
                varying float vY;

                void main() {
                    vec3 normal = normalize(vNormal);
                    vec3 viewDir = normalize(vViewPosition);
                    // 💡 修改 Fresnel 計算，讓邊緣更「虛」
                    float dotProduct = dot(normal, viewDir);
                    // 增加 pow 的次方（例如從 2.0 提高到 4.5），這會讓光束邊緣消散得更快
                    float fresnel = pow(1.0 - max(dotProduct, 0.0), 4.5);

                    // 💡 2. 雙重縱向衰減：讓光束頂部（燈罩處）與底部（地面處）優雅消失
                    // 假設 vY 是從 0 到 -5 (請根據你模型實際高度調整參數)
                    float topFade = smoothstep(0.2, -0.8, vY);    
                    float bottomFade = smoothstep(-5.0, -1.0, vY); 
                    float yGradient = topFade * bottomFade;

                    // 💡 3. 加入微動與呼吸感 (如之前討論)
                    float breathe = sin(uTime * 1.2) * 0.07 + 0.93;
                    
                    // 💡 4. 最終顏色合成 (增加顏色倍率讓 Bloom 更好看)
                    float core = pow(max(dotProduct, 0.0), 2.0) * 0.1; // 輕微的中心亮度
                    float finalAlpha = (fresnel + core) * yGradient * uOpacity * breathe;

                    // 2. 模擬空氣中的塵埃微粒 (動態雜訊)
                    // 💡 你可以調整 0.05 這個數值來控制塵埃的明顯程度
                    float noise = sin(vY * 15.0 + uTime * 2.0) * cos(vNormal.x * 10.0) * 0.05;
                    
                    // 將顏色乘上 (fresnel + 0.2)，這會讓光束正中心看起來更紮實，而邊緣依然柔和
                    gl_FragColor = vec4(beamColor, finalAlpha + noise);
                }
            `,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending
            });

            mesh.material = beamMaterial;
            mesh.renderOrder = 999; // 確保光束在所有物件之後渲染
            mesh.castShadow = false;
        }

        //方法一：
        // --- 第二部分：處理光束圓錐 (核心修正處) ---
        // 使用全小寫變數 name 來判定
        // if (name.includes("cone")) {
        //     console.log("✅ 正在修復並套用高級菲涅耳光束:", mesh.name);

        //     const beamMaterial = new THREE.ShaderMaterial({
        //         uniforms: {
        //             beamColor: { value: new THREE.Color(0xfff3d4) },
        //             fresnelParams: { value: new THREE.Vector3(0.1, 3.5, 0.8) }, // bias, power, scale
        //             uOpacity: { value: 0.7 }
        //         },
        //         vertexShader: `
        //     varying vec3 vNormal;
        //     varying vec3 vViewPosition;
        //     varying float vY;

        //     void main() {
        //         vNormal = normalize(normalMatrix * normal);
        //         vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        //         vViewPosition = -mvPosition.xyz;
        //         vY = position.y; 
        //         gl_Position = projectionMatrix * mvPosition;
        //     }
        // `,
        //         fragmentShader: `
        //     uniform vec3 beamColor;
        //     uniform vec3 fresnelParams;
        //     uniform float uOpacity;

        //     varying vec3 vNormal;
        //     varying vec3 vViewPosition;
        //     varying float vY;

        //     void main() {
        //         // 1. 菲涅耳邊緣光計算
        //         vec3 normal = normalize(vNormal);
        //         vec3 viewDir = normalize(vViewPosition);
        //         float dotProduct = dot(normal, viewDir);
        //         float fresnelStrength = fresnelParams.x + fresnelParams.z * pow(1.0 - max(dotProduct, 0.0), fresnelParams.y);

        //         // 2. 漸層邏輯結合
        //         // yGradient: 底部消失 (smoothstep 第一個參數可依需求調整如 -2.0)
        //         float yGradient = smoothstep(-2.0, 0.5, vY); 

        //         // yCap: 頂部虛化壓制 (解決燈頭過亮爆白問題)
        //         float yCap = smoothstep(1.0, 0.8, vY); 

        //         // 3. 最終合成
        //         float finalAlpha = fresnelStrength * yGradient * yCap * uOpacity;

        //         gl_FragColor = vec4(beamColor, finalAlpha);
        //     }
        // `,
        //         transparent: true,
        //         depthWrite: false,
        //         side: THREE.DoubleSide,
        //         blending: THREE.AdditiveBlending
        //     });

        //     mesh.material = beamMaterial;
        //     mesh.renderOrder = 999;
        //     mesh.castShadow = false;
        //     mesh.receiveShadow = false;
        // }
        //方法二：
        // if (name.includes("cone")) {
        //     console.log("✅ 重新修正光束材質:", mesh.name);

        //     // 直接在建立時定義 uniforms，確保 Shader 抓得到值
        //     const beamMaterial = new THREE.ShaderMaterial({
        //         uniforms: {
        //             beamColor: { value: new THREE.Color(0xfff3d4) },
        //             uOpacity: { value: 0.3 } // 稍微改名避免與內建變數衝突
        //         },
        //         vertexShader: `
        //     varying vec3 vPos;
        //     void main() {
        //         vPos = position; // 傳遞完整座標，避免單一軸向錯誤
        //         gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        //     }
        // `,                // 調整漸層：如果光不見了，試著將 -2.0, 0.3 調小，或是確認模型在 Blender 裡的本地座標中心點位置。
        //         fragmentShader: `
        //     varying vec3 vPos;
        //     uniform vec3 beamColor;
        //     uniform float uOpacity;
        //     void main() {

        //         float strength = smoothstep(-2.0, 0.5, vPos.y); 
        //         gl_FragColor = vec4(beamColor, strength * uOpacity);
        //     }
        // `,
        //         transparent: true,
        //         depthWrite: false, // 確保不擋住陽光
        //         side: THREE.DoubleSide,
        //         blending: THREE.AdditiveBlending
        //     });

        //     mesh.material = beamMaterial;
        //     mesh.renderOrder = 999;
        //     mesh.castShadow = false;
        //     mesh.receiveShadow = false;
        // }

        // --- 第三部分：碰撞與標籤邏輯 (原本的邏輯) ---
        if (name.includes("wall") || (name.includes("door") && !name.includes("locker"))) {
            if (!name.includes("floor") && !name.includes("ground")) {
                collidableObjects.push(mesh);
            }
        }

        if (name.includes("door") || name.includes("門")) {
            doorObjects.push(mesh);
            mesh.userData.isOpen = false;
        }

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
// --- 在 animate 函式外部宣告 ---
const colRaycaster = new THREE.Raycaster();
const worldDir = new THREE.Vector3();
const tempPos = new THREE.Vector3();
const doorPos = new THREE.Vector3(); // 用於計算標籤距離

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now() / 1000; // 現在是「秒」
    const delta = time - prevTime;         // 💡 直接相減即可，不要再除以 1000

    // 防止分頁切換回來後 delta 過大導致穿牆
    if (delta > 0.1) {
        prevTime = time;
        return;
    }

    // --- 1. 更新 LOD 與 Shader 時間 ---
    scene.traverse(obj => {
        if (obj.isLOD) obj.update(camera);
        // 更新光束時間
        if (obj.name.includes("cone") && obj.material && obj.material.uniforms && obj.material.uniforms.uTime) {
            obj.material.uniforms.uTime.value = time;
        }
    });

    // --- 2. 自動進場效果 ---
    if (typeof autoMoveSpeed !== 'undefined' && autoMoveSpeed > 0.01) {
        controls.moveForward(autoMoveSpeed * delta);
        autoMoveSpeed *= Math.pow(0.95, delta * 60);
    }

    // --- 3. 第一人稱控制與碰撞偵測 ---
    if (controls.isLocked) {
        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;

        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize();

        const checkWall = (dirVector) => {
            worldDir.copy(dirVector).applyQuaternion(camera.quaternion);
            worldDir.y = 0;
            worldDir.normalize();

            tempPos.copy(camera.position);
            tempPos.y -= 0.8;

            colRaycaster.set(tempPos, worldDir);
            colRaycaster.far = 0.6;
            return colRaycaster.intersectObjects(collidableObjects).length > 0;
        };

        // 💡 優化： moveDir 也可以宣告在外部重複使用，避免 new Vector3
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

    // --- 4. 更新標籤 ---
    doorObjects.forEach(door => {
        if (door.userData.labelDiv) {
            door.getWorldPosition(doorPos);
            const dist = camera.position.distanceTo(doorPos);
            door.userData.labelDiv.style.opacity = 1.0 - THREE.MathUtils.smoothstep(dist, 5, 15);

            if (Math.random() > 0.995) {
                const temp = (24 + Math.random()).toFixed(1);
                door.userData.labelDiv.textContent = `${door.userData.roomName} (${temp}°C)`;
            }
        }
    });

    // --- 5. 渲染 ---
    prevTime = time;

    if (typeof composer !== 'undefined') {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }

    if (typeof labelRenderer !== 'undefined') {
        labelRenderer.render(scene, camera);
    }
}

// function animate() {
//     requestAnimationFrame(animate);

//     const time = performance.now()/1000;
//     const delta = (time - prevTime) / 1000;

//     // --- 1. 更新 LOD (多層次細節) ---
//     scene.traverse(obj => {
//         if (obj.isLOD) obj.update(camera);
//         if (obj.name.includes("cone") && obj.material.uniforms && obj.material.uniforms.uTime) {
//             obj.material.uniforms.uTime.value = time;}
//     });

//     // --- 2. 自動進場效果 ---
//     if (typeof autoMoveSpeed !== 'undefined' && autoMoveSpeed > 0.01) {
//         controls.moveForward(autoMoveSpeed * delta);
//         autoMoveSpeed *= Math.pow(0.95, delta * 60);
//     }

//     // --- 3. 第一人稱控制與碰撞偵測 ---
//     if (controls.isLocked) {
//         // 摩擦力模擬：讓移動有重量感，不會即停
//         velocity.x -= velocity.x * 10.0 * delta;
//         velocity.z -= velocity.z * 10.0 * delta;

//         direction.z = Number(moveForward) - Number(moveBackward);
//         direction.x = Number(moveRight) - Number(moveLeft);
//         direction.normalize();

//         // 💡 專家級碰撞偵測：使用物件池優化效能
//         const checkWall = (dirVector) => {
//             worldDir.copy(dirVector).applyQuaternion(camera.quaternion);
//             worldDir.y = 0;
//             worldDir.normalize();

//             tempPos.copy(camera.position);
//             tempPos.y -= 0.8; // 射線發射高度（約在腰部）

//             colRaycaster.set(tempPos, worldDir);
//             colRaycaster.far = 0.6; // 偵測距離

//             return colRaycaster.intersectObjects(collidableObjects).length > 0;
//         };

//         if (moveForward || moveBackward) {
//             const moveDir = moveForward ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 0, 1);
//             if (!checkWall(moveDir)) velocity.z -= direction.z * 40.0 * delta;
//         }
//         if (moveLeft || moveRight) {
//             const moveDir = moveLeft ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(1, 0, 0);
//             if (!checkWall(moveDir)) velocity.x -= direction.x * 40.0 * delta;
//         }

//         controls.moveForward(-velocity.z * delta);
//         controls.moveRight(-velocity.x * delta);
//     }

//     // --- 4. 更新 Succuleaf 數位孿生標籤 ---
//     doorObjects.forEach(door => {
//         if (door.userData.labelDiv) {
//             door.getWorldPosition(doorPos);
//             const dist = camera.position.distanceTo(doorPos);

//             // 距離感消失效果：5公尺外開始變淡，15公尺完全透明
//             door.userData.labelDiv.style.opacity = 1.0 - THREE.MathUtils.smoothstep(dist, 5, 15);

//             // 隨機模擬 AIoT 數據跳動
//             if (Math.random() > 0.995) {
//                 const temp = (24 + Math.random()).toFixed(1);
//                 door.userData.labelDiv.textContent = `${door.userData.roomName} (${temp}°C)`;
//             }
//         }
//     });

//     // --- 5. 執行渲染管線 ---
//     prevTime = time;

//     // 💡 優先執行後處理 (WebGL 內容與 Bloom 光暈)
//     if (typeof composer !== 'undefined') {
//         composer.render();
//     } else {
//         renderer.render(scene, camera);
//     }

//     // 💡 最後執行標籤渲染器 (確保文字不被 Bloom 影響，保持清晰)
//     if (typeof labelRenderer !== 'undefined') {
//         labelRenderer.render(scene, camera);
//     }
// }

animate();

// 視窗調整
window.addEventListener('resize', () => {
    const width = window.innerWidth;
    const height = window.innerHeight;

    // 1. 更新相機比例
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    // 2. 更新所有渲染器的大小（標籤與主渲染器）
    renderer.setSize(width, height);
    labelRenderer.setSize(width, height);

    // 3. 更新後處理合成器 (Composer)
    // 雖然繪製的是全螢幕，但內部的緩衝區需要同步
    composer.setSize(width, height);

    // 4. 💡 關鍵效能優化：保持 Bloom 運算在低解析度
    // 這會讓 GPU 在計算「模糊」與「發光」時只處理 1/4 的像素量
    bloomPass.resolution.set(width / 2, height / 2);
});