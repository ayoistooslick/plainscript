function __makeKind_Enemy(EnemyFields) {
  const __rec = { "x": 0, "y": 0, "size": 18, "speed": 0 };
  if (EnemyFields != null) {
    for (const __k in EnemyFields) {
      if (!(Object.prototype.hasOwnProperty.call(__rec, __k))) throw new Error("\"Enemy\" has no field named \"" + __k + "\".");
      __rec[__k] = EnemyFields[__k];
    }
  }
  return __rec;
}
const Enemy = __makeKind_Enemy;
let canvas = document.getElementById("game");
let ctx = canvas.getContext("2d");
let restartButton = document.getElementById("restart");
let keys = {  };
let enemies = [];
let widthValue = 640;
let heightValue = 480;
let playerSize = 24;
let playerX = 308;
let playerY = 420;
let playerSpeed = 240;
let scoreValue = 0;
let lives = 3;
let gameOver = false;
let previousMs = -1;
let spawnTimer = 0.5;
function resetEnemy(e) {
  e.x = 20 + (Math.random() * 600);
  e.y = -30;
  e.speed = 60 + (Math.random() * 120);
}
function spawnEnemy() {
  let e = new Enemy();
  resetEnemy(e);
  enemies.push(e);
}
for (let startCount = 0; (0 <= 4 ? startCount <= 4 : startCount >= 4); startCount += (0 <= 4 ? 1 : -1)) {
  spawnEnemy();
}
document.addEventListener("keydown", function (e) {
  keys[e.key] = true;
});
document.addEventListener("keyup", function (e) {
  keys[e.key] = false;
});
restartButton.addEventListener("click", function (event) {
  scoreValue = 0;
  lives = 3;
  gameOver = false;
  playerX = 308;
  playerY = 420;
  previousMs = -1;
});
requestAnimationFrame(function __frame(__frameTime) {
    let nowMs = performance.now();
    let delta = 0;
    if (previousMs > 0) {
      delta = (nowMs - previousMs) / 1000;
    }
    previousMs = nowMs;
    if (gameOver === false) {
      if (keys["ArrowLeft"] === true || keys["a"] === true) {
        playerX = playerX - (playerSpeed * delta);
      }
      if (keys["ArrowRight"] === true || keys["d"] === true) {
        playerX = playerX + (playerSpeed * delta);
      }
      if (keys["ArrowUp"] === true || keys["w"] === true) {
        playerY = playerY - (playerSpeed * delta);
      }
      if (keys["ArrowDown"] === true || keys["s"] === true) {
        playerY = playerY + (playerSpeed * delta);
      }
      if (playerX < 0) {
        playerX = 0;
      }
      if (playerX > widthValue - playerSize) {
        playerX = widthValue - playerSize;
      }
      if (playerY < 0) {
        playerY = 0;
      }
      if (playerY > heightValue - playerSize) {
        playerY = heightValue - playerSize;
      }
      spawnTimer = spawnTimer - delta;
      if (spawnTimer < 0) {
        spawnEnemy();
        spawnTimer = 1.1;
      }
      for (const e of enemies) {
        e.y = e.y + (e.speed * delta);
        if (e.y > heightValue) {
          scoreValue = scoreValue + 1;
          resetEnemy(e);
        }
        if (e.x < playerX + playerSize && e.x + e.size > playerX && e.y < playerY + playerSize && e.y + e.size > playerY) {
          lives = lives - 1;
          resetEnemy(e);
          if (lives === 0) {
            gameOver = true;
          }
        }
      }
    }
    ctx.clearRect(0, 0, widthValue, heightValue);
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, widthValue, heightValue);
    ctx.fillStyle = "#40c463";
    ctx.fillRect(playerX, playerY, playerSize, playerSize);
    ctx.strokeStyle = "#2ea043";
    ctx.strokeRect(playerX, playerY, playerSize, playerSize);
    ctx.fillStyle = "#ef4444";
    for (const e of enemies) {
      ctx.fillRect(e.x, e.y, e.size, e.size);
    }
    ctx.fillStyle = "#e6edf3";
    ctx.font = "18px sans-serif";
    ctx.fillText("Score: " + scoreValue, 12, 28);
    ctx.fillText("Lives: " + lives, 12, 52);
    if (gameOver === true) {
      ctx.fillStyle = "#f6f8fa";
      ctx.font = "34px sans-serif";
      ctx.fillText("Game Over", 230, 208);
      ctx.font = "18px sans-serif";
      ctx.fillText("Press Restart to play again", 196, 244);
    }
  requestAnimationFrame(__frame);
});
if (typeof module !== 'undefined') { module.exports = { resetEnemy, spawnEnemy }; }