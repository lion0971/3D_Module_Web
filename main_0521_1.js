import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer';
import { CONFIG } from './scene-config.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// ─────────────────────────────────────────
// 一、全域變數
// ─────────────────────────────────────────
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let prevTime = performance.now();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const collidableObjects = [];
const raycaster = new THREE.Raycaster();
const interactiveDevices = [];
const flowingPipes = new Map();
const outletObjects = {};   // faucet_outlet / faucet_2_outlet / shower_outlet / shower_2_outlet ...
const waterFlows = {};      // WaterFlow 實例，key 為完整裝置名稱
let isXRayMode = false;

/** 依目前模式回傳管路「非啟動」狀態的透明度 */
function getInactivePipeOpacity() {
    return isXRayMode ? 0.45 : 0.03;//原0.05
};

// ✅ 動態建立，traverse 時自動新增 key（支援多個裝置）
const activeTimers = {};

const drainFlows = {};   // DrainFlow 實例，key 為 drain 物件名稱

const DEVICE_LABEL = {
    'faucet': '洗手台水龍頭',
    'faucet_2': '浴缸水龍頭',
    'shower': '淋浴蓮蓬頭',
    'shower_2': '浴缸蓮蓬頭',
    // 依實際場景命名增加
};

// ─────────────────────────────────────────
// 二、水流粒子系統
// ─────────────────────────────────────────
class WaterFlow {
    constructor(scene, emitPosition, type = 'faucet') {
        this.scene = scene;
        this.emitPosition = emitPosition.clone();
        this.type = type;
        this.active = false;
        this.count = type === 'shower' ? 400 : 200;
        this.velocities = [];
        this.lifetimes = [];
        this._build();
    }

    _build() {
        const geo = new THREE.BufferGeometry();
        this.positions = new Float32Array(this.count * 3);
        const colors = new Float32Array(this.count * 3);

        for (let i = 0; i < this.count; i++) {
            this.positions[i * 3] = this.emitPosition.x;
            this.positions[i * 3 + 1] = this.emitPosition.y;
            this.positions[i * 3 + 2] = this.emitPosition.z;

            const b = 0.7 + Math.random() * 0.3;
            colors[i * 3] = 0.3 * b;
            colors[i * 3 + 1] = 0.75 * b;
            colors[i * 3 + 2] = 1.0 * b;

            this.lifetimes[i] = Math.random();
            this._resetVelocity(i);
        }

        geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const mat = new THREE.PointsMaterial({
            size: this.type === 'shower' ? 0.025 : 0.035,
            vertexColors: true,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true,
        });

        this.points = new THREE.Points(geo, mat);
        this.points.visible = false;
        this.scene.add(this.points);
    }

    _resetVelocity(i) {
        if (this.type === 'faucet') {
            this.velocities[i] = new THREE.Vector3(
                (Math.random() - 0.5) * 0.015,
                -(0.025 + Math.random() * 0.015),  // 原本 0.04~0.065，改為 0.025~0.04
                (Math.random() - 0.5) * 0.015
            );
        } else {
            const angle = Math.random() * Math.PI * 2;
            const radius = 0.010 + Math.random() * 0.03;
            this.velocities[i] = new THREE.Vector3(
                Math.cos(angle) * radius,
                -(0.02 + Math.random() * 0.02),
                Math.sin(angle) * radius
            );
        }
    }

    _resetParticle(i) {
        const jitter = this.type === 'shower' ? 0.015 : 0.01;
        this.positions[i * 3] = this.emitPosition.x + (Math.random() - 0.5) * jitter;
        this.positions[i * 3 + 1] = this.emitPosition.y;
        this.positions[i * 3 + 2] = this.emitPosition.z + (Math.random() - 0.5) * jitter;
        this.lifetimes[i] = 0;
        this._resetVelocity(i);
    }

    setActive(isActive) {
        this.active = isActive;
        this.points.visible = isActive;
    }

    update(delta) {
        if (!this.active) return;
        const gravity = -0.003;
        const maxLife = this.type === 'faucet' ? 0.2 : 0.9;

        for (let i = 0; i < this.count; i++) {
            this.lifetimes[i] += delta;
            if (this.lifetimes[i] > maxLife) { this._resetParticle(i); continue; }
            this.velocities[i].y += gravity * delta * 60;
            this.positions[i * 3] += this.velocities[i].x;
            this.positions[i * 3 + 1] += this.velocities[i].y;
            this.positions[i * 3 + 2] += this.velocities[i].z;
        }
        this.points.geometry.attributes.position.needsUpdate = true;
        this.points.material.opacity = 0.75 + Math.sin(performance.now() * 0.003) * 0.1;
    }

    dispose() {
        this.scene.remove(this.points);
        this.points.geometry.dispose();
        this.points.material.dispose();
    }
}

// ─────────────────────────────────────────
// DrainFlow：排水口漩渦粒子系統
// ─────────────────────────────────────────
class DrainFlow {
    constructor(scene, drainPosition, radius = 0.6) {
        this.scene = scene;
        this.drainPosition = drainPosition.clone();
        this.radius = radius;
        this.active = false;
        this.count = 500;
        this.particles = [];
        this.fadeOpacity = 0;
        this.fadeDuration = 2.0;
        this.fadeElapsed = 0;
        this._build();
    }

    _build() {
        const geo = new THREE.BufferGeometry();
        this.positions = new Float32Array(this.count * 3);
        this.colors = new Float32Array(this.count * 3);

        for (let i = 0; i < this.count; i++) {
            this._initParticle(i, true);
        }

        geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

        const mat = new THREE.PointsMaterial({
            size: this.radius * 0.038,  // ✅ 跟 radius 連動
            vertexColors: true,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true,
        });

        this.points = new THREE.Points(geo, mat);
        this.points.visible = false;
        this.scene.add(this.points);
    }

    _initParticle(i, randomStart = false) {
        // ✅ 關鍵：pow 指數 > 1 → 大量粒子集中在內圈，外圍自然稀疏
        // pow(rand, 2.5)：外圍極稀，中心極密（類颱風眼牆效果）
        const u = Math.random();
        const r = this.radius * Math.pow(u, 2.5);

        // ✅ 初始角度加上螺旋偏移，讓靜止時就有螺旋臂視覺
        //    r 越大偏移越多 → 產生自然的阿基米德螺線分布
        const spiralOffset = (r / this.radius) * Math.PI * 4;
        const angle = randomStart
            ? Math.random() * Math.PI * 2 - spiralOffset
            : Math.random() * Math.PI * 2 - spiralOffset;

        this.particles[i] = {
            r,
            angle,
            baseSpeed: 0.6 + Math.random() * 0.8,   // 低基礎速度，靠 angularMult 放大
            driftSpeed: 0.0002 + Math.random() * 0.0003, // 極微向心漂移（保持圓面分布）
            life: randomStart ? Math.random() * 3.0 : 0,
            maxLife: 2.0 + Math.random() * 3.0,
        };

        this._updateColor(i);
        this._applyPosition(i);
    }

    // ✅ 依半徑動態更新顏色：中心白藍亮，外圈深藍暗
    _updateColor(i) {
        const p = this.particles[i];
        const t = 1.0 - (p.r / this.radius);   // 0=外圍, 1=中心
        this.colors[i * 3] = 0.25 + t * 0.65;  // R
        this.colors[i * 3 + 1] = 0.60 + t * 0.38;  // G
        this.colors[i * 3 + 2] = 1.0;               // B
    }

    _applyPosition(i) {
        const p = this.particles[i];
        this.positions[i * 3] = this.drainPosition.x + Math.cos(p.angle) * p.r;
        this.positions[i * 3 + 1] = this.drainPosition.y;   // 保持平面，從上看是圓面
        this.positions[i * 3 + 2] = this.drainPosition.z + Math.sin(p.angle) * p.r;
    }

    setActive(isActive) {
        this.active = isActive;
        this.points.visible = isActive;
        if (isActive) {
            this.fadeOpacity = 0;
            this.fadeElapsed = 0;
        }
    }

    update(delta) {
        if (!this.active) return;

        this.fadeElapsed += delta;
        this.fadeOpacity = Math.min(this.fadeElapsed / this.fadeDuration, 1.0);

        for (let i = 0; i < this.count; i++) {
            const p = this.particles[i];

            // ✅ 旋轉速度：內圈速度指數倍放大
            //    外圈（r≈radius）：omega ≈ baseSpeed × 1（慢）
            //    內圈（r≈0）：omega → 爆增（快）
            const omega = p.baseSpeed * Math.pow(this.radius / (p.r + 0.012), 2.2);
            p.angle += omega * delta;

            // ✅ 極微向心漂移：讓粒子緩慢旋入，製造動態感
            //    但不能太強，否則全堆外圈（之前的問題）
            p.r -= p.driftSpeed * this.radius * delta;

            p.life += delta;

            if (p.life >= p.maxLife || p.r < 0.008) {
                // 重生：重新在整個圓面上以中心偏重分布
                this._initParticle(i, false);
            } else {
                this._updateColor(i);   // 移動後更新顏色
                this._applyPosition(i);
            }
        }

        this.points.geometry.attributes.position.needsUpdate = true;
        this.points.geometry.attributes.color.needsUpdate = true;

        const flicker = 0.78 + Math.sin(performance.now() * 0.004) * 0.15;
        this.points.material.opacity = flicker * this.fadeOpacity;
    }

    dispose() {
        this.scene.remove(this.points);
        this.points.geometry.dispose();
        this.points.material.dispose();
    }
}
// ─────────────────────────────────────────
// 三、場景、渲染器、後處理
// ─────────────────────────────────────────
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
    CONFIG.CAMERA.fov,
    window.innerWidth / window.innerHeight,
    0.1, 1000
);
camera.position.set(CONFIG.CAMERA.startPos.x, CONFIG.CAMERA.startPos.y, CONFIG.CAMERA.startPos.z);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.2, 0.5, 0.85
));

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.cssText = 'position:absolute;top:0;pointer-events:none';
document.body.appendChild(labelRenderer.domElement);

// ─────────────────────────────────────────
// 四、工具函式
// ─────────────────────────────────────────

/**
 * 從完整裝置名稱取得裝置類型
 * 'faucet' | 'faucet_2' | 'faucet_3' → 'faucet'
 * 'shower' | 'shower_2'              → 'shower'
 */
function getDeviceType(name) {
    if (name.startsWith('faucet')) return 'faucet';
    if (name.startsWith('shower')) return 'shower';
    return null;
}

function createConeVolumetricLight(color) {
    const h = 3.2;
    const geo = new THREE.ConeGeometry(0.55, h, 32, 1, true);
    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(color) },
            uHeight: { value: h }
        },
        vertexShader: `
            varying float vY; varying vec3 vNormal, vViewDir;
            void main() {
                vY = position.y;
                vec4 wp = modelMatrix * vec4(position,1.0);
                vNormal  = normalize(normalMatrix * normal);
                vViewDir = normalize(cameraPosition - wp.xyz);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
            }`,
        fragmentShader: `
            uniform vec3 uColor; uniform float uHeight;
            varying float vY; varying vec3 vNormal, vViewDir;
            void main() {
                float tF = smoothstep(uHeight/2.0, uHeight/2.0-0.6, vY);
                float bF = smoothstep(-uHeight/2.0, -uHeight/2.0+1.8, vY);
                float rF = smoothstep(0.0, 0.4, abs(dot(vNormal,vViewDir)));
                gl_FragColor = vec4(uColor, 0.22*tF*bF*rF);
            }`,
        transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = -h / 2;
    return mesh;
}

function setupPipeMaterial(mesh, baseColor = 0x00aaff, emissiveColor = 0x0055ff) {
    mesh.material = new THREE.MeshStandardMaterial({
        color: baseColor,
        transparent: true,
        opacity: 0.03,//原0.05
        emissive: new THREE.Color(emissiveColor),
        emissiveIntensity: 0,
        roughness: 0.1,
        metalness: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false,
    });
}

/**
 * 為指定裝置建立水流粒子系統
 * @param {string} deviceName 完整裝置名稱，如 'faucet', 'faucet_2', 'shower_2'
 */
function _createWaterFlow(deviceName) {
    const outletKey = `${deviceName}_outlet`;  // faucet_outlet / faucet_2_outlet
    const deviceType = getDeviceType(deviceName); // 'faucet' | 'shower'
    let emitPos;

    if (outletObjects[outletKey]) {
        emitPos = new THREE.Vector3();
        outletObjects[outletKey].getWorldPosition(emitPos);
        console.log(`[WaterFlow] ${deviceName} outlet 座標`, emitPos);
    } else {
        const deviceMesh = interactiveDevices.find(m => m.name.toLowerCase() === deviceName);
        if (!deviceMesh) {
            console.warn(`[WaterFlow] 找不到 ${deviceName}，水流建立失敗`);
            return;
        }
        const box = new THREE.Box3().setFromObject(deviceMesh);
        emitPos = new THREE.Vector3(
            (box.min.x + box.max.x) / 2,
            box.min.y,
            (box.min.z + box.max.z) / 2
        );
        console.log(`[WaterFlow] ${deviceName} bounding box 座標`, emitPos);
    }

    waterFlows[deviceName] = new WaterFlow(scene, emitPos, deviceType);
}

// ─────────────────────────────────────────
// 五、Loader 宣告
// ─────────────────────────────────────────
const manager = new THREE.LoadingManager();
manager.onLoad = () => {
    const el = document.getElementById('loading-screen');
    if (el) { el.classList.add('fade-out'); setTimeout(() => el.style.display = 'none', 1000); }
};

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');

const loader = new GLTFLoader(manager);
loader.setDRACOLoader(dracoLoader);

const exrLoader = new EXRLoader(manager);

// ─────────────────────────────────────────
// 六、載入資源
// ─────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xffffff, 0.005));

exrLoader.load(CONFIG.MODELS.HDRI, (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdr;
});

loader.load(CONFIG.MODELS.BUILDING, (gltf) => {
    scene.add(gltf.scene);
    gltf.scene.updateMatrixWorld(true);

    // ── 第一遍：收集 outlet 空物件 ────────────────────────────
    // 匹配：faucet_outlet / faucet_2_outlet / shower_outlet / shower_2_outlet ...
    gltf.scene.traverse((obj) => {
        const name = obj.name.toLowerCase();
        if (/^(faucet|shower)(_\d+)?_outlet$/.test(name)) {
            outletObjects[name] = obj;
            console.log(`[Outlet] ${name}`, obj.getWorldPosition(new THREE.Vector3()));
        }
    });

    // ── 第二遍：處理 mesh ─────────────────────────────────────


    gltf.scene.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const name = mesh.name.toLowerCase();

        if (name.includes('drain')) console.log(`[Debug] drain mesh 名稱: "${name}"`);

        // 燈泡
        if (name.includes('bulb')) {
            if (mesh.material) {
                mesh.material.emissive = new THREE.Color(0xffaa44);
                mesh.material.emissiveIntensity = 10;
                if (mesh.material.map) mesh.material.color.setHex(0x444444);
            }
            const cone = createConeVolumetricLight(0xffaa44);
            cone.position.y = 0.2;
            mesh.add(cone);
            const spot = new THREE.SpotLight(0xffaa44, 3, 5, Math.PI / 3.5, 0.6, 2);
            mesh.add(spot);
            mesh.add(spot.target);
            spot.target.position.set(0, -10, 0);
        }

        // ✅ 設備：faucet / faucet_2 / shower / shower_2 ...
        // traverse 中 — 改這行 regex

        if (/^(faucet|shower)(_\d+)?$/.test(name)) {
            interactiveDevices.push(mesh);
            activeTimers[name] = { startTime: null, alerted: false };
            console.log(`[Device] ${name}`);
        }

        // ✅ 冷水管：pipe_faucet / pipe_faucet_2 / pipe_shower / pipe_shower_2 / pipe_restroom
        const isColdPipe = /^pipe_(faucet|shower)(_\d+)?$/.test(name) || name === 'pipe_restroom';

        // ✅ 熱水管：pipe_faucet_w / pipe_faucet_2_w / pipe_shower_w / pipe_shower_2_w / pipe_restroom_w
        const isHotPipe = /^pipe_(faucet|shower)(_\d+)?_w$/.test(name) || name === 'pipe_restroom_w';

        if (isColdPipe) {
            setupPipeMaterial(mesh);                     // 藍色
            flowingPipes.set(name, { mesh, active: false });
            console.log(`[Pipe] ${name}`);
        }
        if (isHotPipe) {
            setupPipeMaterial(mesh, 0xff6600, 0xff3300); // 橘色
            flowingPipes.set(name, { mesh, active: false });
            console.log(`[HotPipe] ${name}`);
        }

        // 碰撞
        if (name.includes('wall') || name.includes('floor')) {
            collidableObjects.push(mesh);
        }

        // ✅ 排水口 sphere：drain / drain_2 / drain_3 ...
        if (/^drain_(faucet|shower)(_\d+)?$/.test(name)) {
            const worldPos = new THREE.Vector3();
            mesh.getWorldPosition(worldPos);

            // 讓球體本身保持可見但半透明，強化視覺提示
            if (mesh.material) {
                mesh.material = new THREE.MeshStandardMaterial({
                    color: 0xff9d1a,
                    transparent: true,
                    opacity: 0.25,
                    roughness: 0.1,
                    metalness: 0.6,
                    depthWrite: false,
                });
            }

            // ✅ 依名稱判斷漩渦大小
            const drainRadius = name.includes('faucet') ? 0.25 : 0.6;
            drainFlows[name] = new DrainFlow(scene, worldPos, drainRadius);
            // 將該排水效果的 Y 軸縮放比例設得非常低（例如原本的 1% 或更低），讓它扁平化
            console.log(`[Drain] ${name}`, worldPos);
        }
    });

    // ✅ 自動為所有偵測到的設備建立水流（支援任意數量）
    interactiveDevices.forEach(mesh => {
        _createWaterFlow(mesh.name.toLowerCase());
    });
});

// ─────────────────────────────────────────
// 七、UI
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// 七、UI
// ─────────────────────────────────────────

// ── 中央選單面板 ──
const menuPanel = document.createElement('div');
Object.assign(menuPanel.style, {
    display: 'none',
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    background: 'rgba(0, 0, 0, 0.75)',
    backdropFilter: 'blur(8px)',
    border: '1px solid rgba(0,255,255,0.4)',
    borderRadius: '12px',
    padding: '24px 36px',
    zIndex: '200',
    display: 'none',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    minWidth: '220px',
    pointerEvents: 'auto',
});
document.body.appendChild(menuPanel);

const menuTitle = document.createElement('div');
menuTitle.innerText = '選單';
Object.assign(menuTitle.style, {
    color: 'rgba(255,255,255,0.6)',
    fontSize: '13px',
    marginBottom: '4px',
    letterSpacing: '2px',
});
menuPanel.appendChild(menuTitle);

const xrayBtn = document.createElement('button');
xrayBtn.innerText = '開啟管路透視模式';
Object.assign(xrayBtn.style, {
    padding: '10px 20px',
    cursor: 'pointer',
    background: 'rgba(0,255,255,0.2)',
    color: 'white',
    border: '1px solid cyan',
    borderRadius: '6px',
    fontSize: '15px',
    width: '100%',
});
xrayBtn.onclick = (e) => {
    e.stopPropagation();   // 阻止事件冒泡
    isXRayMode = !isXRayMode;
    xrayBtn.innerText = isXRayMode ? '關閉管路透視模式' : '開啟管路透視模式';
    xrayBtn.style.background = isXRayMode
        ? 'rgba(0,255,255,0.5)'
        : 'rgba(0,255,255,0.2)';
    toggleXRayMode(isXRayMode);
    closeMenu();
};
menuPanel.appendChild(xrayBtn);

// ── 面板開關函式 ──
function openMenu() {
    if (controls.isLocked) controls.unlock();  // 只在鎖定時才解鎖
    menuPanel.style.display = 'flex';
}

function closeMenu() {
    menuPanel.style.display = 'none';
    setTimeout(() => controls.lock(), 80);
}

// ── 補回這個函式 ──
function toggleXRayMode(enable) {
    const processedMaterials = new Set();
    scene.traverse((obj) => {
        if (!obj.isMesh) return;
        const name = obj.name.toLowerCase();
        const isPipe = name.includes('measure') || name.includes('pipe');
        const isDevice = interactiveDevices.includes(obj) || name.includes('bulb');
        if (isDevice) return;

        const mat = obj.material;
        if (processedMaterials.has(mat)) return;
        processedMaterials.add(mat);

        // ── 管路：只調整「目前未啟動」的管路，啟動中的保持 0.75 不動 ──
        if (isPipe) {
            const pipeEntry = flowingPipes.get(name);
            if (pipeEntry && !pipeEntry.active) {
                mat.opacity = enable ? 0.45 : 0.03;//原0.05
                mat.needsUpdate = true;
            }
            return;
        }

        if (enable) {
            mat.userData._origOpacity = mat.opacity;
            mat.userData._origTransparent = mat.transparent;
            mat.userData._origDepthWrite = mat.depthWrite;
            mat.transparent = true;
            mat.opacity = 0.15;
            mat.depthWrite = false;
        } else {
            mat.opacity = mat.userData._origOpacity ?? 1.0;
            mat.transparent = mat.userData._origTransparent ?? false;
            mat.depthWrite = mat.userData._origDepthWrite ?? true;
        }
        mat.needsUpdate = true;
    });
}

// ── 右鍵開選單 ──
// 取代原本的 contextmenu 監聽
renderer.domElement.addEventListener('dblclick', () => {
    openMenu();
});

// ── 警告彈窗 ──────────────────────────────────────────────────
const warningModal = document.createElement('div');
Object.assign(warningModal.style, {
    display: 'none',
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    background: 'rgba(180, 40, 0, 0.93)',
    color: 'white',
    padding: '28px 40px',
    borderRadius: '12px',
    fontSize: '20px',
    fontWeight: 'bold',
    textAlign: 'center',
    zIndex: '999',
    boxShadow: '0 0 30px rgba(255,100,0,0.8)',
    border: '2px solid orange',
    minWidth: '300px',
    lineHeight: '1.6',
    pointerEvents: 'auto',
});
document.body.appendChild(warningModal);

const warningText = document.createElement('div');
warningModal.appendChild(warningText);

const warningCloseBtn = document.createElement('button');
warningCloseBtn.innerText = '我知道了';
Object.assign(warningCloseBtn.style, {
    padding: '8px 24px',
    cursor: 'pointer',
    background: 'white',
    color: '#c03000',
    border: 'none',
    borderRadius: '6px',
    fontWeight: 'bold',
    fontSize: '15px',
    display: 'block',
    margin: '16px auto 0',
});
warningCloseBtn.onclick = () => {
    warningModal.style.display = 'none';
    for (const key in activeTimers) {
        if (activeTimers[key].startTime) activeTimers[key].startTime = Date.now();
        activeTimers[key].alerted = false;
    }
    // 選單仍開著就不鎖定，讓游標保持可見
    if (menuPanel.style.display !== 'flex') {
        setTimeout(() => controls.lock(), 80);
    }
};
warningModal.appendChild(warningCloseBtn);

const warningOffBtn = document.createElement('button');
warningOffBtn.innerText = '關閉水流';
Object.assign(warningOffBtn.style, {
    padding: '8px 24px',
    cursor: 'pointer',
    background: '#c03000',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontWeight: 'bold',
    fontSize: '15px',
    display: 'block',
    margin: '10px auto 0',
});
warningOffBtn.onclick = () => {
    const deviceName = warningOffBtn.dataset.device;

    // ── 關冷水管 ──
    const pipe = flowingPipes.get(`pipe_${deviceName}`);
    if (pipe) {
        pipe.active = false;
        pipe.mesh.material.opacity = getInactivePipeOpacity();
        pipe.mesh.material.emissiveIntensity = 0;
        waterFlows[deviceName]?.setActive(false);
    }

    // ── 關熱水管 ──
    const hotPipe = flowingPipes.get(`pipe_${deviceName}_w`);
    if (hotPipe) {
        hotPipe.active = false;
        pipe.mesh.material.opacity = getInactivePipeOpacity();
        hotPipe.mesh.material.emissiveIntensity = 0;
    }

    // ── 關排水漩渦 ──
    const drainKey = `drain_${deviceName}`;
    drainFlows[drainKey]?.setActive(false);

    // ── 重設計時器 ──
    if (activeTimers[deviceName]) {
        activeTimers[deviceName].startTime = null;
        activeTimers[deviceName].alerted = false;
    }

    // ── 同步幹管 ──
    let anyActive = false;
    flowingPipes.forEach((p, key) => {
        if (key !== 'pipe_restroom' && key !== 'pipe_restroom_w' && !key.endsWith('_w') && p.active) {
            anyActive = true;
        }
    });
    const total = flowingPipes.get('pipe_restroom');
    if (total) {
        total.active = anyActive;
        total.mesh.material.opacity = anyActive ? 0.6 : getInactivePipeOpacity();
        total.mesh.material.emissiveIntensity = anyActive ? undefined : 0;
    }

    let anyHotActive = false;
    flowingPipes.forEach((p, key) => {
        if (key.endsWith('_w') && key !== 'pipe_restroom_w' && p.active) anyHotActive = true;
    });
    const totalHot = flowingPipes.get('pipe_restroom_w');
    if (totalHot) {
        totalHot.active = anyHotActive;
        totalHot.mesh.material.opacity = anyHotActive ? 0.6 : getInactivePipeOpacity();
        totalHot.mesh.material.emissiveIntensity = anyHotActive ? undefined : 0;
    }

    warningModal.style.display = 'none';
    if (menuPanel.style.display !== 'flex') {
        setTimeout(() => controls.lock(), 80);
    }
};
warningModal.appendChild(warningOffBtn);

/**
 * 顯示出水超時警告
 * @param {string} deviceName 完整裝置名稱，如 'faucet', 'faucet_2', 'shower_2'
 */
function showWarning(deviceName) {
    const label = DEVICE_LABEL[deviceName] ?? deviceName;

    warningText.innerHTML =
        `⚠️ 警告<br>
        <span style="color:#ffdd00;font-size:22px">${label}</span><br>
        已持續出水超過 <span style="color:#ffdd00">1 分鐘</span>！<br>
        請確認是否忘記關閉。`;

    warningModal.style.display = 'block';

    // 把裝置名稱存在按鈕上，讓關閉按鈕知道要關哪個
    warningCloseBtn.dataset.device = deviceName;
    warningOffBtn.dataset.device = deviceName;

    controls.unlock();
}

// ─────────────────────────────────────────
// 八、控制與互動
// ─────────────────────────────────────────
const controls = new PointerLockControls(camera, renderer.domElement);

renderer.domElement.addEventListener('click', () => {
    // 選單開著 → 左鍵關選單
    if (menuPanel.style.display === 'flex') {
        closeMenu();
        return;
    }

    // 未鎖定 → 左鍵鎖定，不做其他事
    if (!controls.isLocked) {
        controls.lock();
        return;
    }

    // 已鎖定 → 正常 raycaster 互動
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = raycaster.intersectObjects(interactiveDevices);
    if (!intersects.length) return;

    const targetName = intersects[0].object.name.toLowerCase(); // e.g. 'faucet_2'
    console.log(`[Click] ${targetName}`);

    // ── 冷水管：pipe_faucet / pipe_faucet_2 / pipe_shower_2 ... ──
    const pipe = flowingPipes.get(`pipe_${targetName}`);
    console.log(`[Click] 管路:`, pipe ? '✅' : '❌ 找不到，請確認命名');

    if (pipe) {
        pipe.active = !pipe.active;
        waterFlows[targetName]?.setActive(pipe.active);
        pipe.mesh.material.opacity = pipe.active ? 0.75 : getInactivePipeOpacity();
        if (!pipe.active) pipe.mesh.material.emissiveIntensity = 0;

        // 計時器
        if (activeTimers[targetName]) {
            if (pipe.active) {
                activeTimers[targetName].startTime = Date.now();
                activeTimers[targetName].alerted = false;
            } else {
                activeTimers[targetName].startTime = null;
            }
        }
    }

    // ── 熱水管：pipe_faucet_w / pipe_faucet_2_w / pipe_shower_2_w ... ──
    const hotPipeKey = `pipe_${targetName}_w`;
    const hotPipe = flowingPipes.get(hotPipeKey);
    const isNowActive = pipe?.active ?? false;

    if (hotPipe) {
        hotPipe.active = isNowActive;
        hotPipe.mesh.material.opacity = isNowActive ? 0.75 : getInactivePipeOpacity();
        if (!isNowActive) hotPipe.mesh.material.emissiveIntensity = 0;
    }

    // ── 同步冷水幹管 pipe_restroom（只要有任何冷水管 active 就亮）──
    let anyActive = false;
    flowingPipes.forEach((p, key) => {
        if (key !== 'pipe_restroom' && key !== 'pipe_restroom_w' && !key.endsWith('_w') && p.active) {
            anyActive = true;
        }
    });

    const total = flowingPipes.get('pipe_restroom');
    if (total) {
        total.active = anyActive;
        total.mesh.material.opacity = anyActive ? 0.6 : getInactivePipeOpacity();
        if (!anyActive) total.mesh.material.emissiveIntensity = 0;
    }

    // ── 同步熱水幹管 pipe_restroom_w（只要有任何熱水管 active 就亮）──
    let anyHotActive = false;
    flowingPipes.forEach((p, key) => {
        if (key.endsWith('_w') && key !== 'pipe_restroom_w' && p.active) {
            anyHotActive = true;
        }
    });

    const totalHot = flowingPipes.get('pipe_restroom_w');
    if (totalHot) {
        totalHot.active = anyHotActive;
        totalHot.mesh.material.opacity = anyHotActive ? 0.6 : getInactivePipeOpacity();
        if (!anyHotActive) totalHot.mesh.material.emissiveIntensity = 0;
    }

    // ── 在 pipe.active 切換後，同步對應的 drain 漩渦 ──
    // 'faucet' → 'drain_faucet'，'shower_2' → 'drain_shower_2'
    const drainKey = `drain_${targetName}`;

    if (drainFlows[drainKey]) {
        drainFlows[drainKey].setActive(pipe?.active ?? false);
    }
});

document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyW') moveForward = true;
    if (e.code === 'KeyS') moveBackward = true;
    if (e.code === 'KeyA') moveLeft = true;
    if (e.code === 'KeyD') moveRight = true;
});
document.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW') moveForward = false;
    if (e.code === 'KeyS') moveBackward = false;
    if (e.code === 'KeyA') moveLeft = false;
    if (e.code === 'KeyD') moveRight = false;
});

// ─────────────────────────────────────────
// 九、動畫迴圈
// ─────────────────────────────────────────
const WARNING_MS = 10 * 1000; // 60 秒

function animate() {
    requestAnimationFrame(animate);
    const time = performance.now() / 1000;
    const delta = Math.min(time - prevTime, 0.1);

    // 水流粒子
    for (const key in waterFlows) waterFlows[key].update(delta);
    // 排水漩渦粒子更新
    for (const key in drainFlows) drainFlows[key].update(delta);

    // 管路 emissive 波動
    flowingPipes.forEach((p) => {
        if (!p.mesh.material) return;
        p.mesh.material.emissiveIntensity = p.active
            ? 0.6 + Math.sin(time * 10) * 0.4
            : 0;
    });

    // 內部計時 → 超過 60 秒跳警告
    for (const key in activeTimers) {
        const timer = activeTimers[key];
        if (timer.startTime && !timer.alerted) {
            if (Date.now() - timer.startTime >= WARNING_MS) {
                timer.alerted = true;
                showWarning(key);
            }
        }
    }

    // 移動
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

// ─────────────────────────────────────────
// 十、視窗調整
// ─────────────────────────────────────────
window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    labelRenderer.setSize(w, h);
});