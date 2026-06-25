# AI Stock Screener Pro 🤖📊

An advanced, automated quantitative trading assistant that fetches stock data, computes pricing technical indices, fits an AI Machine Learning model (Random Forest Regressor) in real-time, and predicts short-term bullish returns with dynamic take-profit targets.

This repository contains both the **Python Terminal Edition** and a **Web Dashboard Edition** that runs entirely in the browser and is deployable to GitHub Pages.

---

## 📁 Repository Structure

```
stock-bot_zenixy/
├── app.py                  # Python Terminal Edition (Original code)
├── requirements.txt        # Python dependencies
├── .gitignore              # Git ignore rules for node & python
├── .github/
│   └── workflows/
│       └── deploy.yml      # GitHub Actions CI/CD to build & deploy web app
└── web/                    # Web App folder
    ├── package.json        # Frontend dependencies
    ├── vite.config.ts      # Vite bundler configuration (base path configured)
    └── src/
        ├── main.tsx        # React entrypoint
        ├── App.tsx         # Dashboard UI, SVG Charts, & similar stocks logic
        ├── App.css         # Premium Glassmorphic CSS Styling
        ├── screener.ts     # Tech Indicator & data fetching logic
        └── RandomForest.ts # Custom JS/TS Random Forest Regressor
```

---

## 💻 1. Python Terminal Edition (Local)

To run the original Python command line interface:

### Install dependencies
```bash
pip install -r requirements.txt
```

### Run the script
```bash
python app.py
```

---

## 🌐 2. Web Dashboard Edition (Local Development)

The web dashboard provides a gorgeous dark-theme visual UI with charts, custom settings, a similar stocks finder, and a retro scrolling terminal simulation that mimics the Python scanning outputs.

### Install dependencies
```bash
cd web
npm install
```

### Run the development server
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🚀 3. Deploy to GitHub Pages (Available Online Anywhere)

To host the site online for free on GitHub Pages, follow these simple steps to push the code to your GitHub account:

### Step 1: Create a Repository on GitHub
Go to [GitHub](https://github.com) and create a **new empty repository**. You can name it `stock-bot_zenixy`. *Do not check any boxes like "Add a README" or "Add .gitignore".*

### Step 2: Link and Push the Local Repository
Open your terminal in this directory and run the following commands (replace `<YOUR-GITHUB-USERNAME>` and `<YOUR-REPO-NAME>` with your details):

```bash
# Add the remote link (Choose HTTPS or SSH based on your GitHub setup)
git remote add origin https://github.com/<YOUR-GITHUB-USERNAME>/<YOUR-REPO-NAME>.git

# Push the code to GitHub
git push -u origin main
```

### Step 3: Enable GitHub Pages Deployments
1. Once pushed, go to your repository on GitHub.
2. The **GitHub Actions** workflow will automatically start compiling and building the web application. You can watch it in the **Actions** tab.
3. Once the workflow completes, a new branch named `gh-pages` will be created automatically.
4. Go to **Settings** > **Pages** in your GitHub repository menu.
5. Under **Build and deployment** > **Source**, make sure **Deploy from a branch** is selected.
6. Under **Branch**, select `gh-pages` and `/ (root)`, then click **Save**.
7. In a few seconds, your site will be live at `https://<YOUR-GITHUB-USERNAME>.github.io/<YOUR-REPO-NAME>/`!

---

## 🧠 Algorithmic Indicators Computed
* **Price Change:** 1, 5, and 10 periods.
* **Price moving averages (SMA):** 5, 10, and 20 periods.
* **Volatility (ATR & Standard Deviation):** 10-period standard deviation / rolling mean.
* **Volume Metrics:** Change in trading volume, rolling average volume, and relative volume ratio.
* **AI Prediction Model:** Direct fit of a Decision Forest Ensemble (`RandomForestRegressor`) in JavaScript to output short-term returns.
