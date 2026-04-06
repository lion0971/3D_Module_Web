console.log('main loaded');
import * as THREE from 'three';
import { SceneManager } from './SceneManager.js';
import { AssetLoader } from './AssetLoader.js';
import { PlayerControl } from './PlayerControl.js';
import { Interaction } from './Interaction.js';

// --- 1. 初始化核心組件 ---
const manager = new THREE.LoadingManager();
const app = new SceneManager();
const assets = new AssetLoader(app.scene, manager);
const player = new PlayerControl(app.camera, app.renderer.domElement);
const interaction = new Interaction(app.camera);
const clock = new THREE.Clock();

// --- 2. 資源狀態管理 ---
const collidableObjects = []; // 儲存牆壁等碰撞物
const doorObjects = [];       // 儲存可互動的門

// 取得 HTML 中的 UI 元素
const loaderBar = document.getElementById('loader-bar');
const loaderText = document.getElementById('loader-text');

// --- 3. 載入資源 ---

// 載入環境貼圖 (HDR)
assets.loadEnvironment('hdri/studio.exr');

// 載入建築模型
assets.loadBuilding(
    'models/20260228cad-3d-gltf.glb', 
    (percent) => {
        // 更新進度條 UI
        if (loaderBar) loaderBar.style.width = `${percent}%`;
        if (loaderText) loaderText.innerText = `載入數位分身... ${percent}%`;
    },
    (gltf) => {
        const model = gltf.scene;
        
        // 定義房間標籤數據 (與你先前的代碼一致)
        const roomData = { 
            "in_door1": "會議室 101", 
            "in_door2": "會議室 102", 
            "in_door3": "茶水間" 
        };

        // 遍歷模型物件，分類與處理
        model.traverse((node) => {
            if (!node.isMesh) return;

            const name = node.name.toLowerCase();

            // A. 判定碰撞體 (牆壁、結構)
            // 排除地面與天花板，避免玩家無法移動
            if (name.includes("wall") || (name.includes("door") && !name.includes("locker"))) {
                if (!name.includes("floor") && !name.includes("ground")) {
                    collidableObjects.push(node);
                }
            }

            // B. 判定可互動的門
            if (name.includes("door") || node.name.includes("門")) {
                doorObjects.push(node);
                node.userData.isOpen = false; // 初始化門的狀態
                
                // C. 綁定 UI 標籤
                if (roomData[node.name]) {
                    const div = document.createElement('div');
                    div.className = 'door-label';
                    div.textContent = roomData[node.name];
                    
                    // 封裝進 CSS2DObject
                    import('three/examples/jsm/renderers/CSS2DRenderer').then(module => {
                        const label = new module.CSS2DObject(div);
                        label.position.set(0, 2.2, 0); // 標籤浮在門上方
                        node.add(label);
                        node.userData.labelDiv = div;
                        node.userData.roomName = roomData[node.name];
                    });
                }
            }
        });

        app.scene.add(model);
    }
);

// --- 4. 註冊互動事件 ---

// 監聽點擊事件，交由 Interaction 模組判斷是否點到門
window.addEventListener('click', () => {
    // 只有在滑鼠鎖定狀態下才觸發門互動（避免誤觸）
    if (player.controls.isLocked) {
        interaction.handleDoorInteract(doorObjects);
    }
});

// 監聽視窗縮放
window.addEventListener('resize', () => app.onWindowResize());

// --- 5. 主動畫循環 ---

function animate() {
    requestAnimationFrame(animate);

    // 取得兩幀之間的時間差 (確保移動平滑)
    const delta = clock.getDelta();

    // 更新 LOD (如果有植物等 LOD 物件)
    app.scene.traverse(obj => {
        if (obj.isLOD) obj.update(app.camera);
    });

    // 更新玩家位移與碰撞
    player.update(delta, collidableObjects);

    // 更新互動標籤（透明度與模擬數據）
    interaction.updateLabels(doorObjects);

    // 執行渲染
    app.render();
}

// 啟動動畫
animate();

// --- 6. 載入完成處理 ---
manager.onLoad = () => {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
        setTimeout(() => {
            loadingScreen.style.opacity = '0';
            setTimeout(() => {
                loadingScreen.style.display = 'none';
            }, 1000);
        }, 500);
    }
};