//負責處理「點擊門」的動畫效果以及 2D UI 標籤（如溫度、房間名）的動態更新

import * as THREE from 'three';

export class Interaction {
    constructor(camera) {
        this.camera = camera;
        this.raycaster = new THREE.Raycaster();
    }

    // 處理開門點擊
    handleDoorInteract(doorObjects) {
        // 從相機中心射出射線
        this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
        const intersects = this.raycaster.intersectObjects(doorObjects);
        
        if (intersects.length > 0) {
            const door = intersects[0].object;
            door.userData.isOpen = !door.userData.isOpen;
            
            // 旋轉動畫邏輯
            const angle = (door.name === "out_door" || door.name.includes("out")) ? -Math.PI / 2 : Math.PI / 2;
            door.rotation.y = door.userData.isOpen ? angle : 0;
            
            console.log(`觸發互動: ${door.userData.roomName || door.name} -> ${door.userData.isOpen ? '開啟' : '關閉'}`);
        }
    }

    // 更新懸浮標籤
    updateLabels(doorObjects) {
        doorObjects.forEach(door => {
            if (door.userData.labelDiv) {
                const doorPos = new THREE.Vector3();
                door.getWorldPosition(doorPos);
                const dist = this.camera.position.distanceTo(doorPos);
                
                // 距離控制：太遠則隱藏，靠近則顯示
                const opacity = 1.0 - THREE.MathUtils.smoothstep(dist, 5, 12);
                door.userData.labelDiv.style.opacity = opacity;

                // 模擬 IoT 數據（隨機跳動溫度）
                if (opacity > 0 && Math.random() > 0.99) {
                    const temp = (24 + Math.random() * 1.5).toFixed(1);
                    door.userData.labelDiv.textContent = `${door.userData.roomName} (${temp}°C)`;
                }
            }
        });
    }
}