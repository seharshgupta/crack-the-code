# 🔒 Crack the Code

A real-time, turn-based multiplayer number guessing game built with **Node.js** and **Socket.io**. Players join rooms, set secret codes, and race to crack their opponent's code using logic and deduction.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D14.0.0-green.svg)
![Socket.io](https://img.shields.io/badge/socket.io-real--time-black)

## 🌟 Features

* **Real-Time Multiplayer:** Instant room creation and joining via Socket.io.
* **Turn-Based Logic:** Server-side turn enforcement prevents playing out of order.
* **Live Chat:** Integrated chat system to talk with your opponent while playing.
* **Responsive Design:** Fully optimized for both Desktop and Mobile (stacked layout on phones).
* **Live Lobby:** See player updates in real-time before the game starts.
* **Help System:** Built-in modal popups explaining "Bulls" and "Cows" rules.
* **Smart Validation:** Ensures secret codes and guesses are exactly 4 unique digits.

## 🛠️ Tech Stack

* **Backend:** Node.js, Express
* **WebSocket:** Socket.io
* **Frontend:** HTML5, CSS3, Vanilla JavaScript
* **Styling:** Custom CSS (Responsive Flexbox/Grid)

## 🚀 Getting Started

Follow these instructions to set up the project locally on your machine.

### Prerequisites
* [Node.js](https://nodejs.org/) installed on your computer.

### Installation

1.  **Clone the repository**
    ```bash
    git clone [https://github.com/seharshgupta/crack-the-code.git](https://github.com/seharshgupta/crack-the-code.git)
    cd crack-the-code
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Start the server**
    ```bash
    node server.js
    ```
    *(Or `npm start` if you set up the script in package.json)*

4.  **Play the game**
    Open your browser and navigate to:
    `http://localhost:3000`

    *To test multiplayer locally, open the link in two different browser tabs or windows.*

## 🎮 How to Play

1.  **Create a Room:** Enter your name and click "Create Room". Share the 4-digit **Room ID** with a friend.
2.  **Join a Room:** Your friend enters their name and the Room ID to join.
3.  **Set Secret:** Both players enter a secret **4-digit number** (digits must be unique, e.g., `1234` is valid, `1122` is not).
4.  **Guessing Phase:**
    * Players take turns entering a 4-digit guess.
    * **Bulls (🎯):** Correct digit in the **correct** position.
    * **Cows (🐮):** Correct digit in the **wrong** position.
5.  **Winning:** The first player to get **4 Bulls** (guess the exact number) wins the game!

## 📂 Project Structure

```text
crack-the-code/
├── node_modules/       # Dependencies
├── .gitignore          # Files to ignore (node_modules, etc.)
├── index.html          # Frontend UI (HTML/CSS/JS)
├── package.json        # Project metadata and scripts
├── package-lock.json   # Dependency tree lock
└── server.js           # Backend logic (Express + Socket.io)