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
// 降低 Bloom 強度避免爆白 (原本 0.6 改為 0.25)
// 降低 strength (第一個參數)，建議設為 0.1 ~ 0.15 即可
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.12,  // 強度 (原本可能 0.25 或更高)
  0.4,   // 半徑
  0.85   // 閾值 (提高此值可以讓較暗的地方不產生發光效果)
);
composer.addPass(bloomPass);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0px';
labelRenderer.domElement.style.pointerEvents = 'none';
document.body.appendChild(labelRenderer.domElement);

// --- 3. 核心：粒子生成函式 ---
function createVolumetricLight(color) {
  const particleCount = 500;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const opacities = new Float32Array(particleCount);

  for (let i = 0; i < particleCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radiusFactor = Math.random();

    const y = -Math.random() * 2.5; // 光束長度，2.5公尺

    // 💡 關鍵：降低 spread 係數 (原本可能是 1.5，改成 0.4 左右)
    // 數值越小，光束越細，角度越窄
    const spread = 0.02 + ((-y / 2.5) * 0.4);
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
                pos.x += sin(uTime * 0.5 + vY) * 0.01; // 微小擾動
                vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                gl_PointSize = (2.0 + (-vY * 1.5)) * (300.0 / length(mvPosition.xyz));
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
    fragmentShader: `
            uniform vec3 uColor;
            varying float vOpacity;
            varying float vY;
            void main() {
                float d = length(gl_PointCoord - vec2(0.5));
                if (d > 0.5) discard;
                float mask = smoothstep(0.5, 0.2, d);
                float topFade = smoothstep(0.0, -0.3, vY);
                float bottomFade = smoothstep(-2.5, -1.8, vY);
                // 極低亮度確保溫馨感
                // 💡 將最後的乘數調得非常低。
// 從 0.02 降到 0.005 ~ 0.008 之間，這會讓光束看起來像薄霧
gl_FragColor = vec4(uColor, vOpacity * mask * topFade * bottomFade * 0.006);
            }
        `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  return new THREE.Points(geometry, material);
}

// --- 4. 載入管理與模型 ---
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

scene.add(new THREE.AmbientLight(0xffffff, 0.05));
new EXRLoader(manager).load(CONFIG.MODELS.HDRI, (hdr) => {
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = hdr;
});

loader.load(CONFIG.MODELS.BUILDING, (gltf) => {
  scene.add(gltf.scene);

  gltf.scene.traverse((mesh) => {
    if (!mesh.isMesh) return;

    const name = mesh.name.toLowerCase();

    // --- 核心修正：改用父子綁定法 ---
    if (name.includes("bulb")) {
      console.log("發現燈泡，綁定光束:", mesh.name);

      // 1. 生成光束 (相對於燈泡中心 0,0,0)
      const vLight = createVolumetricLight(0xfff3d4);

      // 2. 💡 關鍵：直接將光束加為燈泡的「子物件」
      // 這樣不管模型怎麼移動，光束都會自動跟隨，不會瞬移到外面
      mesh.add(vLight);
      lightParticles.push(vLight);

      // 3. 燈泡本體發光
      if (mesh.material) {
        mesh.material.emissive = new THREE.Color(0xfff3d4);
        mesh.material.emissiveIntensity = 0.5; // 調低這個，讓燈泡有顏色而不是純白
      }
    }

    // 碰撞設定
    if (name.includes("wall") || (name.includes("door") && !name.includes("locker"))) {
      collidableObjects.push(mesh);
    }
  });
}, (xhr) => {
  console.log((xhr.loaded / xhr.total * 100) + '% loaded');
}, (error) => {
  console.error("載入模型出錯:", error);
});

// --- 5. 控制與動畫 ---
const controls = new PointerLockControls(camera, renderer.domElement);
renderer.domElement.addEventListener('click', () => controls.lock());

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