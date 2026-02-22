## 動圖功能安裝說明

為了支援動圖重組功能，需要安裝以下額外的 Node.js 模組：

### 快速安裝
```powershell
cd d:\2.programm2\topic\download-picture
npm install adm-zip jimp gif-encoder-2
```

### 各模組用途
- **adm-zip**: 解壓 Pixiv 動圖 ZIP 檔案
- **jimp**: 圖片處理和像素操作
- **gif-encoder-2**: 高品質 GIF 創建

### 安裝完成後
重新執行動圖下載：
```powershell
node index.js --id=141449024
```

現在會下載並重組為完整的 `.gif` 動圖檔案！

### 注意事項
- 動圖重組需要一些時間，請耐心等待
- GIF 檔案可能比原始 ZIP 檔案更大
- 如果重組失敗，會回退到下載 ZIP 檔案