// scene-config.js
export const CONFIG = {
    MODELS: {
        PLANT: 'models/Plant_Turtle_LOD.glb',
        BUILDING: 'models/20260418-3d.glb',
        HDRI: 'hdri/studio.exr'
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