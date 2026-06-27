import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
//import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { CONFIG } from './scene-config.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

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

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  //logarithmicDepthBuffer: true // 環境太大，camera抓不出微小距離差異
});
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
labelRenderer.domElement.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;width:100%;height:100%';
document.body.appendChild(labelRenderer.domElement);

RectAreaLightUniformsLib.init();//

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
// ✅ 只宣告一次 manager
const manager = new THREE.LoadingManager();

const loadingScreen = document.getElementById('loading-screen');
const instructions = document.getElementById('instructions');

function finishLoading() {
  instructions.classList.add('at-corner');
  loadingScreen.classList.add('fade-out');

  setTimeout(() => {
    document.body.appendChild(instructions);
    loadingScreen.style.display = 'none';
  }, 600);
}

manager.onLoad = finishLoading;

manager.onProgress = (url, loaded, total) => {
  const percent = (loaded / total) * 100;
  const bar = document.getElementById('loader-bar');
  const text = document.getElementById('loader-text');
  if (bar) bar.style.width = percent + '%';
  if (text) text.textContent = `正在載入... ${Math.round(percent)}%`;
};

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');

const loader = new GLTFLoader(manager);
loader.setDRACOLoader(dracoLoader);

const rgbeLoader = new RGBELoader(manager);
//const exrLoader = new EXRLoader(manager);

// ─────────────────────────────────────────
// 六、載入資源
// ─────────────────────────────────────────
// 背景格線
const gridHelper = new THREE.GridHelper(100, 100, 0xffffff, 0x888888);
gridHelper.material.opacity = 0.3;
gridHelper.material.transparent = true;
scene.add(gridHelper);

scene.add(new THREE.AmbientLight(0xffffff, 0.005));

rgbeLoader.load(CONFIG.MODELS.HDRI, (hdr) => {
  console.log('HDRI 載入成功', hdr);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = hdr;
  scene.background = hdr;
});
// exrLoader.load(CONFIG.MODELS.HDRI, (hdr) => {
//   hdr.mapping = THREE.EquirectangularReflectionMapping;
//   scene.environment = hdr;
// });

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
      const isLineBulb = name.includes('line_bulb');
      const isBallBulb = name.includes('ball_bulb');
      const isRecBulb = name.includes('rec_bulb');

      if (isLineBulb) {
        if (mesh.material) {
          mesh.material.emissive = new THREE.Color(0xffcc66);
          mesh.material.emissiveIntensity = 3;
          if (mesh.material.map) mesh.material.color.setHex(0x888866);
        }

        // ── 用 geometry 的本地包圍盒，避免世界座標轉換問題 ──
        mesh.geometry.computeBoundingBox();
        const localBox = mesh.geometry.boundingBox;  // 本地座標，不受 mesh 位置影響
        const localSize = new THREE.Vector3();
        localBox.getSize(localSize);
        const localCenterGeo = new THREE.Vector3();
        localBox.getCenter(localCenterGeo);  // geometry 在本地空間的中心

        // 判斷主軸（geometry 本地空間）
        let axis = new THREE.Vector3(0, 1, 0);
        if (localSize.x >= localSize.y && localSize.x >= localSize.z) {
          axis.set(1, 0, 0);
        } else if (localSize.z >= localSize.x && localSize.z >= localSize.y) {
          axis.set(0, 0, 1);
        }

        const axisLength = Math.max(localSize.x, localSize.y, localSize.z);
        const numLights = Math.max(3, Math.ceil(axisLength / 0.8));

        for (let i = 0; i < numLights; i++) {
          const t = numLights === 1 ? 0 : (i / (numLights - 1) - 0.5);
          const lp = new THREE.PointLight(0xffcc66, 0.3, 2.5, 1.5);
          // 從 geometry 中心出發，沿主軸均勻分佈
          lp.position.copy(localCenterGeo).addScaledVector(axis, t * axisLength);
          mesh.add(lp);
        }

        // ── 光暈圓柱（geometry 本地空間對齊）──
        const glowLen = axisLength * 1.02;
        const glowGeo = new THREE.CylinderGeometry(0.03, 0.03, glowLen, 8, 1, true);

        // CylinderGeometry 預設長軸是 Y，需旋轉對齊實際主軸
        if (axis.x === 1) glowGeo.rotateZ(Math.PI / 2);
        else if (axis.z === 1) glowGeo.rotateX(Math.PI / 2);

        const glowMesh = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
          color: 0xffcc66,
          transparent: true,
          opacity: 0.1,
          side: THREE.BackSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }));
        glowMesh.position.copy(localCenterGeo);
        mesh.add(glowMesh);

        const outerGlowGeo = new THREE.CylinderGeometry(0.09, 0.09, glowLen, 8, 1, true);
        if (axis.x === 1) outerGlowGeo.rotateZ(Math.PI / 2);
        else if (axis.z === 1) outerGlowGeo.rotateX(Math.PI / 2);

        const outerGlowMesh = new THREE.Mesh(outerGlowGeo, new THREE.MeshBasicMaterial({
          color: 0xffaa33,
          transparent: true,
          opacity: 0.03,
          side: THREE.BackSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }));
        outerGlowMesh.position.copy(localCenterGeo);
        mesh.add(outerGlowMesh);
      }
      else if (isBallBulb) {
        // ── 球型燈泡 ──
        if (mesh.material) {
          mesh.material.emissive = new THREE.Color(0xffcc88);
          mesh.material.emissiveIntensity = 12;
          if (mesh.material.map) mesh.material.color.setHex(0x888866);
        }

        mesh.geometry.computeBoundingBox();
        const localBox = mesh.geometry.boundingBox;
        const localSize = new THREE.Vector3();
        localBox.getSize(localSize);
        const localCenterGeo = new THREE.Vector3();
        localBox.getCenter(localCenterGeo);

        const baseRadius = Math.max(localSize.x, localSize.y, localSize.z) * 0.5;

        const pt = new THREE.PointLight(0xffcc88, 4.0, 8.0, 2);
        pt.position.copy(localCenterGeo);
        mesh.add(pt);

        // 💡 精密微調的發光層次：前段密集重疊以疊出亮度，後段跨度加大並讓不透明度劇烈衰減，完美模擬霧狀淡出
        const glowLayers = [
          { radius: baseRadius * 1.05, opacity: 0.45 }, // 最內層貼緊本體
          { radius: baseRadius * 1.15, opacity: 0.35 }, // 密集疊加層
          { radius: baseRadius * 1.35, opacity: 0.25 }, // 密集疊加層
          { radius: baseRadius * 1.70, opacity: 0.16 }, // 中間漸變
          { radius: baseRadius * 2.30, opacity: 0.09 }, // 擴散開始
          { radius: baseRadius * 3.20, opacity: 0.04 }, // 邊緣淡出
          { radius: baseRadius * 4.50, opacity: 0.015 } // 終點柔和消融（加寬半徑，降低不透明度）
        ];

        glowLayers.forEach(({ radius, opacity }) => {
          // 💡 調整一：段數從 16 提升到 32，消除多邊形硬邊
          const geo = new THREE.SphereGeometry(radius, 32, 32);

          const mat = new THREE.MeshBasicMaterial({
            color: 0xffcc88,
            transparent: true,
            opacity,
            side: THREE.BackSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,

            // 🔥 調整二：開啟 Dithering（抖動防斷層），這是消除黑色背景下洋蔥圈痕跡的核心關鍵
            dithering: true
          });

          const m = new THREE.Mesh(geo, mat);
          m.userData.isBallBulbGlow = true;
          m.material.userData._baseOpacity = opacity;
          m.position.copy(localCenterGeo);
          mesh.add(m);
        });

      } else if (isRecBulb) {
        mesh.geometry.computeBoundingBox();
        const localBox = mesh.geometry.boundingBox;
        const localSize = new THREE.Vector3();
        localBox.getSize(localSize);
        const localCenterGeo = new THREE.Vector3();
        localBox.getCenter(localCenterGeo);

        // 取得 mesh 的世界方向
        const worldDir = new THREE.Vector3();
        mesh.getWorldDirection(worldDir);

        // 取得世界座標位置
        const worldPos = new THREE.Vector3();
        mesh.getWorldPosition(worldPos);

        // 取得世界旋轉
        const worldEuler = new THREE.Euler();
        worldEuler.setFromQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion()));

        console.log('=== RecBulb Debug ===');
        console.log('mesh.name:', mesh.name);
        console.log('localSize:', localSize);
        console.log('localCenter:', localCenterGeo);
        console.log('worldPosition:', worldPos);
        console.log('worldDirection:', worldDir);
        console.log('worldRotation (deg):', {
          x: THREE.MathUtils.radToDeg(worldEuler.x).toFixed(1),
          y: THREE.MathUtils.radToDeg(worldEuler.y).toFixed(1),
          z: THREE.MathUtils.radToDeg(worldEuler.z).toFixed(1),
        });
        console.log('mesh.rotation (deg):', {
          x: THREE.MathUtils.radToDeg(mesh.rotation.x).toFixed(1),
          y: THREE.MathUtils.radToDeg(mesh.rotation.y).toFixed(1),
          z: THREE.MathUtils.radToDeg(mesh.rotation.z).toFixed(1),
        });
        console.log('====================');
      } else {

        const wp = new THREE.Vector3();
        mesh.getWorldPosition(wp);
        console.log(`[bulb] ${name} 世界座標: x=${wp.x.toFixed(2)} y=${wp.y.toFixed(2)} z=${wp.z.toFixed(2)}`);

        // ── 原本的點燈泡邏輯（維持不變）──
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

// ── 太陽平行光（右前方斜上 45°）──
// ── 太陽平行光（位置由 applyDayNight 動態設定）──
const sunLight = new THREE.DirectionalLight(0xfff5e0, 0);
scene.add(sunLight);
scene.add(sunLight.target);  // target 預設原點

// 太陽視覺球體
const sunMesh = new THREE.Mesh(
  new THREE.SphereGeometry(1.8, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0xffee88 })
);
scene.add(sunMesh);

const sunGlow = new THREE.Mesh(
  new THREE.SphereGeometry(3.2, 16, 16),
  new THREE.MeshBasicMaterial({
    color: 0xffcc33, transparent: true,
    opacity: 0.18, side: THREE.BackSide, depthWrite: false,
  })
);
sunMesh.add(sunGlow);
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
// 日夜滑桿（ESC 顯示 / 左鍵鎖定後隱藏）
// ─────────────────────────────────────────
let targetBulbStrength = 1.0;
let currentBulbStrength = 1.0;
const BULB_LERP_SPEED = 30.0;
const bulbMeshes = [];

function collectBulbs() {
  scene.traverse((obj) => {
    if (!obj.isMesh || !obj.name.toLowerCase().includes('bulb')) return;
    const name = obj.name.toLowerCase();
    const isLineBulb = /line_+bulb/.test(name);
    const isBallBulb = name.includes('ball_bulb');
    const isRecBulb = name.includes('rec_bulb');

    if (isLineBulb) {
      const lights = obj.children.filter(c => c.isPointLight);
      bulbMeshes.push({ mesh: obj, spot: null, lineLights: lights, ballLight: null, rectLight: null });
    } else if (isBallBulb) {
      const pt = obj.children.find(c => c.isPointLight) ?? null;
      bulbMeshes.push({ mesh: obj, spot: null, lineLights: null, ballLight: pt, rectLight: null });
    } else if (isRecBulb) {
      const rl = obj.children.find(c => c.isRectAreaLight) ?? null;
      bulbMeshes.push({ mesh: obj, spot: null, lineLights: null, ballLight: null, rectLight: rl });
    } else {
      const spot = obj.children.find(c => c.isSpotLight) ?? null;
      bulbMeshes.push({ mesh: obj, spot, lineLights: null, ballLight: null, rectLight: null });
    }
  });
};

// 掛在 manager.onLoad 之後執行
const _origOnLoad = manager.onLoad;
manager.onLoad = () => {
  _origOnLoad?.();
  collectBulbs();
  applyDayNight(parseFloat(daySlider.value));
};

// ── 滑桿容器（預設隱藏）──
const sliderWrap = document.createElement('div');
Object.assign(sliderWrap.style, {
  position: 'fixed',
  bottom: '28px',
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  background: 'rgba(0,0,0,0.55)',
  backdropFilter: 'blur(6px)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: '40px',
  padding: '10px 22px',
  zIndex: '300',
  pointerEvents: 'none',       // ← 預設不可互動
  userSelect: 'none',
  opacity: '0',          // ← 預設透明
  transition: 'opacity 0.3s ease',
});
document.body.appendChild(sliderWrap);

sliderWrap.appendChild(Object.assign(document.createElement('span'), {
  textContent: '🌙', style: 'font-size:22px'
}));

const daySlider = document.createElement('input');
Object.assign(daySlider, { type: 'range', min: '0', max: '100', value: '50' });
Object.assign(daySlider.style, { width: '200px', cursor: 'pointer', accentColor: '#ffd97a' });
sliderWrap.appendChild(daySlider);

sliderWrap.appendChild(Object.assign(document.createElement('span'), {
  textContent: '☀️', style: 'font-size:22px'
}));

// ── 核心日夜函式 ──
function applyDayNight(t) {
  const n = t / 100;   // 0 = 地平線, 1 = 45° 仰角

  // ── 1. 太陽仰角（0° → 45°）及位置 ──────────────────────
  const elevation = n * (Math.PI / 4);     // 0 → π/4 (45°)
  const azimuth = Math.PI / 4;           // 固定右前方 45° 方位角
  const dist = 60;

  const sx = Math.cos(elevation) * Math.sin(azimuth) * dist;
  const sy = Math.sin(elevation) * dist;
  const sz = +Math.cos(elevation) * Math.cos(azimuth) * dist;// 第一個-Math改成+Math，右前方移到右後方

  sunLight.position.set(sx, sy, sz);
  sunMesh.position.set(sx, sy, sz);

  // ── 2. 太陽光強度：sin(仰角)，地平線時幾乎為 0 ──────────
  const sinElev = Math.sin(elevation);         // 0 → 0.707
  sunLight.intensity = sinElev * 3.6;

  // ── 3. 太陽色溫：地平線橙紅 → 高空暖白 ──────────────────
  const dawnColor = new THREE.Color(0xffd0a0);
  const noonColor = new THREE.Color(0xfff5e0);
  const sunColor = dawnColor.clone().lerp(noonColor, n);
  sunLight.color.copy(sunColor);
  sunMesh.material.color.copy(sunColor);

  // ── 4. 渲染曝光：地平線暗 → 高空亮 ──────────────────────
  renderer.toneMappingExposure = 0.2 + n * 1.0;   // 0.2 → 1.2

  // ── 5. 環境光：隨仰角增強 ────────────────────────────────
  const ambLight = scene.children.find(o => o.isAmbientLight);
  if (ambLight) ambLight.intensity = 0.005 + n * 0.5;

  // ── 6. 天空色：暗橙（地平線）→ 淺藍（高空）─────────────
  if (scene.background instanceof THREE.Color) {
    scene.background.lerpColors(
      new THREE.Color(0x0d0503),   // 近黑暗橙
      new THREE.Color(0x87ceeb),   // 晴天藍
      n
    );
  }

  // ── 7. 室內燈泡：太陽低時維持開燈，超過 55 即滅 ─────────
  // ── 7. 室內燈泡：固定原始亮度，超過 55 即滅 ──
  if (n <= 0.5) {
    const refExp = 1.8;
    const curExp = 1.3 + n;
    targetBulbStrength = Math.min(refExp / curExp, 3.0);
  } else if (n <= 0.55) {
    targetBulbStrength = 1.0
  } else {
    targetBulbStrength = 0.0;
  }

  // ❌ 舊的（有補償，會越來越亮）：
  // if (n <= 0.5) {
  //     const refExp = 0.2 + 0.5 * 1.0;
  //     const curExp = 0.1 + n * 0.6;
  //     targetBulbStrength = Math.min(refExp / curExp, 3.0);
  // } else if (n <= 0.55) {
  //     targetBulbStrength = 0.70;
  // } else {
  //     targetBulbStrength = 0.0;
  // }

  // ✅ 新的（固定原始亮度）：
  //targetBulbStrength = n <= 0.50 ? 1.0 : 0.0;
};

function applyBulbStrength(s) {
  bulbMeshes.forEach(({ mesh, spot, lineLights, ballLight, rectLight }) => {
    if (mesh.material) {
      if (lineLights) mesh.material.emissiveIntensity = s * 3;
      else if (ballLight) mesh.material.emissiveIntensity = s * 12;
      else if (rectLight) mesh.material.emissiveIntensity = s * 3;
      else mesh.material.emissiveIntensity = s * 10;
    }
    if (spot) spot.intensity = s * 3;
    if (ballLight) ballLight.intensity = s * 4.0;
    if (rectLight) rectLight.intensity = s * 3;
    if (lineLights) lineLights.forEach(l => l.intensity = s * 0.3);

    mesh.children.forEach(c => {
      if (!c.isMesh) return;
      if (c.userData.isLineBulbGlow || c.userData.isBallBulbGlow || c.userData.isRecBulbGlow) {
        const base = c.material.userData._baseOpacity ?? 0.1;
        c.material.opacity = s > 0.05 ? base : 0;
        c.material.needsUpdate = true;
      }
    });
  });
};

daySlider.addEventListener('input', () => applyDayNight(parseFloat(daySlider.value)));
daySlider.addEventListener('mousedown', e => e.stopPropagation());
daySlider.addEventListener('click', e => e.stopPropagation());
// ─────────────────────────────────────────
// 八、控制與互動
// ─────────────────────────────────────────
const controls = new PointerLockControls(camera, renderer.domElement);

// ── 鎖定/解鎖時切換滑桿顯示 ──
controls.addEventListener('lock', () => {
  sliderWrap.style.opacity = '0';
  sliderWrap.style.pointerEvents = 'none';
});

controls.addEventListener('unlock', () => {
  // 警告彈窗開著時不顯示（避免重疊）
  if (warningModal.style.display !== 'block') {
    sliderWrap.style.opacity = '1';
    sliderWrap.style.pointerEvents = 'auto';
  }
});

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
  // 移動
  if (controls.isLocked) {
    velocity.x -= velocity.x * 10.0 * delta;
    velocity.z -= velocity.z * 10.0 * delta;
    direction.z = Number(moveForward) - Number(moveBackward);
    direction.x = Number(moveRight) - Number(moveLeft);
    direction.normalize();
    if (moveForward || moveBackward) velocity.z -= direction.z * 40.0 * delta;
    if (moveLeft || moveRight) velocity.x -= direction.x * 40.0 * delta;

    // ── 手機長按前進 ──
    if (isHoldWalking && !isTouchMoving) {
      controls.moveForward(3.0 * delta);
    }

    controls.moveForward(-velocity.z * delta);
    controls.moveRight(-velocity.x * delta);
  }

  // ── 燈泡平滑 lerp ──
  if (Math.abs(currentBulbStrength - targetBulbStrength) > 0.001) {
    currentBulbStrength += (targetBulbStrength - currentBulbStrength)
      * Math.min(BULB_LERP_SPEED * delta, 1.0);
    applyBulbStrength(currentBulbStrength);
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

// ─────────────────────────────────────────
// 十一、手機觸控支援
// ─────────────────────────────────────────

const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
let isTouchMoving = false;
let isHoldWalking = false;
let holdTimer = null;

if (isMobile) {
  let lastTapTime = 0;
  let tapTimer = null;
  let touchStartX = 0, touchStartY = 0;
  let lastTouchX = 0, lastTouchY = 0;
  let isMobileLocked = false; // 模擬 PointerLock 的鎖定狀態

  const DOUBLE_TAP_MS = 300;   // 雙點間隔上限
  const MOVE_THRESHOLD = 8;    // 超過這個 px 就算滑動，不算點擊
  const TOUCH_SENSITIVITY = 0.003; // 視角靈敏度

  // ── 模擬鎖定狀態（手機不支援 PointerLock）──
  function mobileLock() {
    if (isMobileLocked) return;
    isMobileLocked = true;
    // 觸發 controls 的 lock 事件讓 UI 同步（隱藏滑桿）
    sliderWrap.style.opacity = '0';
    sliderWrap.style.pointerEvents = 'none';
  }

  function mobileUnlock() {
    if (!isMobileLocked) return;
    isMobileLocked = false;
    if (warningModal.style.display !== 'block') {
      sliderWrap.style.opacity = '1';
      sliderWrap.style.pointerEvents = 'auto';
    }
  }

  // ── 複寫 controls.isLocked，讓原本邏輯正常運作 ──
  Object.defineProperty(controls, 'isLocked', {
    get: () => isMobileLocked,
    configurable: true,
  });

  // ── 視角旋轉（拖曳）──
  renderer.domElement.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) return;
  const t = e.touches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
  lastTouchX = t.clientX;
  lastTouchY = t.clientY;
  isTouchMoving = false;

  // ── 長按計時 ──
  holdTimer = setTimeout(() => {
    if (!isTouchMoving) isHoldWalking = true; // 沒有在滑動才啟動前進
  }, 300);
}, { passive: true });

  renderer.domElement.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - lastTouchX;
    const dy = t.clientY - lastTouchY;
    lastTouchX = t.clientX;
    lastTouchY = t.clientY;

    const totalDx = Math.abs(t.clientX - touchStartX);
    const totalDy = Math.abs(t.clientY - touchStartY);
    if (totalDx > MOVE_THRESHOLD || totalDy > MOVE_THRESHOLD) {
      isTouchMoving = true;
    }

    if (isMobileLocked) {
      // 水平 → 左右轉頭（yaw）
      camera.rotation.y -= dx * TOUCH_SENSITIVITY * 2;
      // 垂直 → 上下看（pitch），限制角度避免翻轉
      camera.rotation.x -= dy * TOUCH_SENSITIVITY * 2;
      camera.rotation.x = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, camera.rotation.x));
    }
  }, { passive: true });

  renderer.domElement.addEventListener('touchend', (e) => {
  // 長按停止
  clearTimeout(holdTimer);
  isHoldWalking = false;
  renderer.domElement._prevAvgY = null;

  if (isTouchMoving) return; // 滑動不算點擊

  const now = Date.now();
  const diff = now - lastTapTime;

  if (diff < DOUBLE_TAP_MS && diff > 0) {
    clearTimeout(tapTimer);
    lastTapTime = 0;
    mobileUnlock();
    openMenu();
  } else {
    lastTapTime = now;
    tapTimer = setTimeout(() => {
      if (menuPanel.style.display === 'flex') {
        closeMenu();
        mobileLock();
        return;
      }
      if (!isMobileLocked) {
        mobileLock();
        return;
      }
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      const intersects = raycaster.intersectObjects(interactiveDevices);
      if (!intersects.length) return;
      const clickEvent = new MouseEvent('click', { bubbles: false });
      renderer.domElement.dispatchEvent(clickEvent);
    }, DOUBLE_TAP_MS);
  }
}, { passive: true });

  // ── 移動（虛擬搖桿區域）──
  // 手指雙指觸控：兩指同時滑動 → 前後移動
  renderer.domElement.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2) return;
    // 雙指向上 → 前進，向下 → 後退
    const avgY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    if (!renderer.domElement._prevAvgY) {
      renderer.domElement._prevAvgY = avgY;
      return;
    }
    const dy = renderer.domElement._prevAvgY - avgY;
    renderer.domElement._prevAvgY = avgY;
    if (Math.abs(dy) > 1) {
      controls.moveForward(dy * 0.02);
    }
  }, { passive: true });

  renderer.domElement.addEventListener('touchcancel', () => {
    clearTimeout(holdTimer);
    isHoldWalking = false;
  }, { passive: true });
}