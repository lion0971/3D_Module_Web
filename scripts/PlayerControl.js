//移動與物理碰撞-將 WASD 邏輯與碰撞偵測封裝。這對手機 GPU 來說非常重要，因為我們優化了碰撞檢測的頻率與射線長度

import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls';

export class PlayerControl {
    constructor(camera, domElement) {
        this.controls = new PointerLockControls(camera, domElement);
        this.velocity = new THREE.Vector3();
        this.direction = new THREE.Vector3();
        this.moveStates = { forward: false, backward: false, left: false, right: false };
        
        this.initEventListeners(domElement);
    }

    initEventListeners(domElement) {
        document.addEventListener('keydown', (e) => this.onKeyChange(e.code, true));
        document.addEventListener('keyup', (e) => this.onKeyChange(e.code, false));
        domElement.addEventListener('click', () => {
            if (!this.controls.isLocked) this.controls.lock();
        });
    }

    onKeyChange(code, isDown) {
        switch (code) {
            case 'KeyW': this.moveStates.forward = isDown; break;
            case 'KeyS': this.moveStates.backward = isDown; break;
            case 'KeyA': this.moveStates.left = isDown; break;
            case 'KeyD': this.moveStates.right = isDown; break;
        }
    }

    update(delta, collidables) {
        if (!this.controls.isLocked) return;

        // 阻力模擬 (Friction)
        this.velocity.x -= this.velocity.x * 10.0 * delta;
        this.velocity.z -= this.velocity.z * 10.0 * delta;

        this.direction.z = Number(this.moveStates.forward) - Number(this.moveStates.backward);
        this.direction.x = Number(this.moveStates.right) - Number(this.moveStates.left);
        this.direction.normalize();

        // 碰撞偵測邏輯
        if (this.moveStates.forward || this.moveStates.backward) {
            const moveDir = this.moveStates.forward ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 0, 1);
            if (!this.checkCollision(moveDir, collidables)) {
                this.velocity.z -= this.direction.z * 40.0 * delta;
            }
        }
        if (this.moveStates.left || this.moveStates.right) {
            const moveDir = this.moveStates.left ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(1, 0, 0);
            if (!this.checkCollision(moveDir, collidables)) {
                this.velocity.x -= this.direction.x * 40.0 * delta;
            }
        }

        this.controls.moveForward(-this.velocity.z * delta);
        this.controls.moveRight(-this.velocity.x * delta);
    }

    checkCollision(dirVector, collidables) {
        if (collidables.length === 0) return false;

        const raycaster = new THREE.Raycaster();
        // 將移動方向轉換為世界座標方向
        const worldDir = dirVector.clone().applyQuaternion(this.controls.getObject().quaternion);
        worldDir.y = 0; 
        worldDir.normalize();
        
        // 射線起點設在相機位置（稍微降低一點，接近腰部高度）
        const pos = this.controls.getObject().position.clone();
        pos.y -= 0.8; 
        
        raycaster.set(pos, worldDir);
        raycaster.far = 0.7; // 碰撞偵測距離，太短會穿牆，太長會走不動
        return raycaster.intersectObjects(collidables).length > 0;
    }
}