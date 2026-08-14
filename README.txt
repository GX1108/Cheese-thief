========================================
奶酪大盜 Cheese Thief - 使用說明 README
========================================

這個資料夾裡有一個桌遊網頁遊戲，分成兩種玩法：

1. game.html         →  本機傳遞裝置版（大家輪流用同一台電腦/平板玩，不需要網路）
2. server/           →  連線多人版（每人用自己的手機/電腦連進同一個伺服器一起玩）

以下教你怎麼在你自己的電腦上把這兩種玩法都跑起來，以及如何把連線版部署到雲端
（Render），讓任何人打開網址就能玩，不用你的電腦一直開著。


----------------------------------------
第 0 步：解壓縮
----------------------------------------
把整個 zip 檔解壓縮到你電腦上的任何資料夾，例如：
    C:\cheese-thief\

解壓縮後你應該會看到：
    cheese-thief/
      ├─ game.html
      ├─ picture/
      ├─ render.yaml
      └─ server/
           ├─ server.js
           ├─ package.json
           ├─ package-lock.json
           └─ public/


----------------------------------------
第 1 步：最簡單的玩法 — 本機傳遞裝置版（不需要安裝任何東西）
----------------------------------------
如果只是想在同一台電腦/平板上，大家輪流玩：

1. 直接對 game.html 點兩下（或按右鍵 → 選擇瀏覽器開啟）。
2. 用 Chrome、Edge 或任何瀏覽器打開後就能直接玩，不需要網路、不需要安裝任何軟體。

這個版本完全在瀏覽器裡跑，沒有伺服器，每個人輪流用同一個裝置查看自己的身分。


----------------------------------------
第 2 步：連線多人版 — 在你自己電腦上架設伺服器
----------------------------------------

(2-1) 安裝 Node.js（只需要做一次）
    1. 到 https://nodejs.org 下載「LTS」版本並安裝（一路下一步即可）。
    2. 安裝完成後，打開「命令提示字元」或「PowerShell」，輸入：
           node -v
       如果有顯示版本號（例如 v20.x.x），代表安裝成功。

(2-2) 安裝專案相依套件（只需要做一次）
    1. 打開 PowerShell 或命令提示字元。
    2. 切換到 server 資料夾，例如：
           cd C:\cheese-thief\server
    3. 執行：
           npm install
       這會自動下載 express 和 ws 兩個套件，等它跑完（畫面出現 "added XX packages" 之類文字）。

(2-3) 啟動伺服器
    1. 確認還在 server 資料夾內，執行：
           npm start
    2. 看到畫面顯示：
           奶酪大盜 伺服器已啟動： http://localhost:8080
       就代表伺服器啟動成功了。
    3. 不要關掉這個視窗（關掉視窗伺服器就會停止）。

(2-4) 開始玩（自己電腦）
    1. 打開瀏覽器，輸入網址：
           http://localhost:8080
    2. 就會看到「奶酪大盜」連線版首頁，可以創建房間或加入房間。

(2-5) 讓同一個 Wi-Fi / 區網的其他人一起玩
    1. 在你的電腦上打開 PowerShell，輸入：
           ipconfig
       找到「IPv4 位址」，例如 192.168.1.23（每台電腦不一樣，要自己查）。
    2. 其他人只要跟你連同一個 Wi-Fi/路由器，用瀏覽器打開：
           http://你的IP位址:8080
       例如：http://192.168.1.23:8080
    3. 大家都能連進同一個伺服器一起玩了。
    4. 如果別人連不上，檢查 Windows 防火牆是否封鎖了 Node.js 或連接埠 8080，
       第一次執行 npm start 時如果跳出「Windows 防火牆已封鎖某些功能」的視窗，
       記得勾選「私人網路」允許存取。

(2-6) 關閉伺服器
    在跑著 npm start 的那個視窗按 Ctrl + C 即可停止。之後要再玩，重複 (2-3) 即可
    （不需要重新 npm install，除非你把 server 資料夾整個換掉）。


----------------------------------------
第 3 步（進階）：部署到雲端，讓任何人隨時都能連進來玩
----------------------------------------
如果想讓朋友不用跟你同一個 Wi-Fi，隨時打開一個固定網址就能玩，
可以把 server 部署到 Render（有免費方案）。步驟如下：

(3-1) 建立 GitHub 帳號並建立空白倉庫
    1. 到 https://github.com 註冊帳號（如果還沒有的話）。
    2. 登入後到 https://github.com/new
    3. 倉庫名稱隨意，例如 cheese-thief，不要勾選「Add a README file」，
       建立一個「空白」的倉庫。
    4. 建立完成後，網頁上會顯示一個網址，例如：
           https://github.com/你的帳號/cheese-thief.git
       先記下來。

(3-2) 把專案推上 GitHub
    1. 打開 PowerShell，切換到專案最外層資料夾（cheese-thief，不是 server）：
           cd C:\cheese-thief
    2. 依序執行以下指令：
           git init
           git add .
           git commit -m "Cheese Thief"
           git branch -M main
           git remote add origin https://github.com/你的帳號/cheese-thief.git
           git push -u origin main
    3. 如果是第一次在這台電腦用 git，可能會跳出瀏覽器要求登入 GitHub 帳號，
       登入並授權後即可繼續。
    4. 如果跳出瀏覽器登入頁面一直卡住或連不上，改用「個人存取權杖」推送：
           a. 到 https://github.com/settings/tokens/new 建立一個 token，
              權限勾選 "repo"，設定過期時間，按「Generate token」，複製產生的字串
              （長得像 ghp_xxxxxxxxxxxxxxxxxxxx）。
           b. 執行（把「你的帳號」和「你的PAT」換成實際內容）：
                  git remote set-url origin https://你的帳號:你的PAT@github.com/你的帳號/cheese-thief.git
                  git push -u origin main

(3-3) 在 Render 上部署
    1. 到 https://render.com 註冊/登入（可以直接用 GitHub 帳號登入最方便）。
    2. 登入後點「New +」→「Web Service」。
    3. 選擇剛剛建立的 cheese-thief 這個 GitHub 倉庫，授權 Render 存取它。
    4. 因為專案裡已經附上 render.yaml，Render 通常會自動偵測到以下設定，
       如果沒有自動帶入，手動填寫：
           Root Directory：server
           Build Command：npm install
           Start Command：npm start
           Plan：Free
    5. 按「Create Web Service」，等待幾分鐘讓它建置完成。
    6. 建置完成後，Render 會給一個網址，例如：
           https://cheese-thief.onrender.com
       之後任何人打開這個網址就能連線玩，不需要你的電腦開機。

(3-4) 免費方案的小提醒
    - 免費方案在沒人使用一段時間後（約 15 分鐘）會自動休眠，
      下次有人打開網址時，需要等 30~60 秒喚醒伺服器，屬正常現象，耐心等待即可。
    - 之後你只要修改程式碼、重新 git push，Render 會自動重新部署最新版本。


----------------------------------------
常見問題
----------------------------------------
Q: 雙擊 game.html 沒有反應或畫面空白？
A: 改用「右鍵 → 開啟檔案的方式 → 選擇 Chrome/Edge」再試一次。

Q: npm install 或 npm start 出現「無法辨識為 Cmdlet」或類似錯誤？
A: 代表 Node.js 沒裝好或沒加入系統路徑，重新安裝 Node.js LTS 版本，
   安裝時保持預設選項即可，安裝完重開一個新的 PowerShell 視窗再試。

Q: npm start 出現 "EADDRINUSE" (port 8080 已被使用)？
A: 代表已經有一個伺服器在跑了，先在原本那個視窗按 Ctrl + C 關閉，
   或者換一個埠號啟動：
       $env:PORT=3000; npm start
   然後改用 http://localhost:3000 開啟。

Q: 其他電腦打不開我的區網網址？
A: 確認彼此在同一個 Wi-Fi/路由器下、確認 Windows 防火牆允許 Node.js 存取「私人網路」、
   確認你打的 IP 位址是正確的（用 ipconfig 重新確認一次）。

Q: 想要修改遊戲規則或畫面？
A: game.html 是本機版原始碼；server/server.js 是連線版後端邏輯；
   server/public/index.html 是連線版前端畫面。都是純文字檔，可以用記事本或
   VS Code 打開編輯。
