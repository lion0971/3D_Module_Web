# 3D_Module_Web
# 1. 把萬用字元規則從追蹤中移除
git lfs untrack "*.glb"
git lfs untrack "*.exr"

# 2-1. 把現有這個 44.2MB 的 glb 從 LFS 快取移除，改一般方式加入
git rm --cached 你的模型檔案.glb
git add 你的模型檔案.glb

# 2-2. 把現有的 exr 從 LFS 快取移除，改一般方式加入
git rm --cached 你的貼圖檔案.exr
git add 你的貼圖檔案.exr

# 3. 如果你的 .exr 檔案真的很大、想繼續用 LFS，針對它單獨加回追蹤
git lfs track "你的貼圖檔案.exr"

# 4. 加入修改後的 .gitattributes，一併提交
git add .gitattributes
git commit -m "switch to per-file LFS tracking instead of wildcard"
git push

#列出目前被 Git LFS 記錄的所有檔案完整路徑
git lfs ls-files

出來的結果比如:a1b2c3d4 * models/20260702_compressed_webp.glb
星號後面那一整段（包含資料夾路徑）才是你要拿去替換指令裡檔名的正確完整路徑
