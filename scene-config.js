// scene-config.js
// 不用去管是不是 GitHub，兩邊都用標準相對路徑
const basePath = './';

export const CONFIG = {
    MODELS: {
        PLANT: `${basePath}models/Plant_Turtle_LOD.glb`,
        BUILDING: `${basePath}models/20260702_compressed_webp.glb`,
        HDRI: `${basePath}hdri/studio-0623.hdr`
    },
    ROOM_DATA: {
        "in_door1": "會議室 101",
        "in_door2": "會議室 102",
        "in_door3": "茶水間"
    },
   CAMERA: {
        fov: 60,
        startPos: { x: 2.4, y: 1.5, z: -3 },
        lookAtPos: { x: 0, y: 1.5, z: 0 } // 明確定義看向中心
    }
};