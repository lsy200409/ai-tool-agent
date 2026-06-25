// ===== Particle Background System =====
// 模拟明日方舟官网风格的星空粒子网络

(function() {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let particles = [];
    let mouseX = -1000;
    let mouseY = -1000;
    const maxDistance = 120;  // 粒子连线最大距离
    const particleCount = 80;  // 粒子数量

    // 画布自适应
    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resize);
    resize();

    // 粒子类
    class Particle {
        constructor() {
            this.reset();
            this.y = Math.random() * canvas.height;  // 初始随机分布
        }

        reset() {
            this.x = Math.random() * canvas.width;
            this.y = -10;
            this.size = Math.random() * 2 + 1;
            this.speedY = Math.random() * 0.5 + 0.2;
            this.speedX = (Math.random() - 0.5) * 0.3;
            this.opacity = Math.random() * 0.5 + 0.3;
        }

        update() {
            this.y += this.speedY;
            this.x += this.speedX;

            // 超出屏幕时重置
            if (this.y > canvas.height + 10 ||
                this.x < -10 ||
                this.x > canvas.width + 10) {
                this.reset();
                this.y = -10;
            }
        }

        draw(ctx) {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(108, 92, 231, ${this.opacity})`;
            ctx.fill();
        }
    }

    // 初始化粒子
    for (let i = 0; i < particleCount; i++) {
        particles.push(new Particle());
    }

    // 鼠标追踪
    document.addEventListener('mousemove', function(e) {
        mouseX = e.clientX;
        mouseY = e.clientY;
    });

    document.addEventListener('mouseleave', function() {
        mouseX = -1000;
        mouseY = -1000;
    });

    // 绘制连线
    function drawLines(ctx, particles) {
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < maxDistance) {
                    const opacity = (1 - distance / maxDistance) * 0.15;
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = `rgba(108, 92, 231, ${opacity})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }

            // 鼠标附近的粒子连线高亮
            const dx = particles[i].x - mouseX;
            const dy = particles[i].y - mouseY;
            const mouseDist = Math.sqrt(dx * dx + dy * dy);

            if (mouseDist < 150) {
                const opacity = (1 - mouseDist / 150) * 0.4;
                ctx.beginPath();
                ctx.moveTo(particles[i].x, particles[i].y);
                ctx.lineTo(mouseX, mouseY);
                ctx.strokeStyle = `rgba(0, 210, 255, ${opacity})`;
                ctx.lineWidth = 1;
                ctx.stroke();

                // 鼠标附近的粒子变大变亮
                particles[i].size = Math.min(3, particles[i].size + 0.5);
                particles[i].opacity = Math.min(0.9, particles[i].opacity + 0.1);
            }
        }
    }

    // 动画循环
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 更新和绘制粒子
        for (let p of particles) {
            p.update();
            p.draw(ctx);
        }

        // 绘制连线
        drawLines(ctx, particles);

        requestAnimationFrame(animate);
    }

    animate();
})();
