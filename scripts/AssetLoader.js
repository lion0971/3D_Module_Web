//高品質資產載入-將原本混亂的加載邏輯封裝，特別是你處理植物材質與 LOD 的部分

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader';
import * as THREE from 'three';

export class AssetLoader {
    constructor(scene, manager) {
        this.scene = scene;
        this.manager = manager;
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
        this.gltfLoader = new GLTFLoader(manager);
        this.gltfLoader.setDRACOLoader(dracoLoader);
    }

    loadEnvironment(path) {
        new EXRLoader(this.manager).load(path, (hdr) => {
            hdr.mapping = THREE.EquirectangularReflectionMapping;
            this.scene.environment = hdr;
            this.scene.environmentIntensity = 4.5;
        });
    }

    loadPlants(path) {
        this.gltfLoader.load(path, (gltf) => {
            // ...這裡放你原本那段複雜的 createLODLevel 邏輯...
            // 建議將 LOD 物件傳回 scene.add(lod)
        });
    }

    loadBuilding(path, onProcess, onComplete) {
        this.gltfLoader.load(path, onComplete, (xhr) => {
            const percent = Math.round((xhr.loaded / xhr.total) * 100);
            onProcess(percent);
        });
    }
}