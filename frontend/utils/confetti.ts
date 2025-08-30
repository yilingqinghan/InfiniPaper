// frontend/utils/confetti.ts
export async function fireConfetti() {
    const confetti = (await import("canvas-confetti")).default;
    const end = Date.now() + 600;
    (function frame() {
      confetti({
        particleCount: 3, spread: 60, origin: {x: Math.random(), y: 0.2},
        colors: ["#60a5fa","#34d399","#f59e0b","#f472b6","#a78bfa"]
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }