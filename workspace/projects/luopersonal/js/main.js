// ===== Main Interactions =====

document.addEventListener('DOMContentLoaded', function() {
    // 1. 打字机效果
    initTypingEffect();

    // 2. 数字递增动画
    initCountUp();

    // 3. 滚动渐显动画
    initScrollReveal();

    // 4. 导航栏滚动效果
    initNavScroll();
});

// ===== 打字机效果 =====
function initTypingEffect() {
    const typingElement = document.getElementById('typing-text');
    const cursor = document.querySelector('.cursor');
    if (!typingElement) return;

    const text = '你好，我是罗先生';
    let index = 0;
    const speed = 80;  // 打字速度 (ms)

    function type() {
        if (index < text.length) {
            typingElement.textContent += text.charAt(index);
            index++;
            setTimeout(type, speed);
        } else {
            // 打字完成后光标停止闪烁
            if (cursor) {
                cursor.style.animation = 'none';
                cursor.style.opacity = '0';
            }
        }
    }

    // 延迟 500ms 开始打字
    setTimeout(type, 500);
}

// ===== 数字递增动画 =====
function initCountUp() {
    const statNumbers = document.querySelectorAll('.stat-number');
    if (statNumbers.length === 0) return;

    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            if (entry.isIntersecting) {
                const el = entry.target;
                const target = parseInt(el.getAttribute('data-count'));
                const suffix = target >= 10 && el.parentElement.querySelector('.stat-label').textContent.includes('%') ? '%+' : '+';
                const duration = 2000;  // 动画持续时间
                const startTime = performance.now();

                function update(currentTime) {
                    const elapsed = currentTime - startTime;
                    const progress = Math.min(elapsed / duration, 1);
                    // easeOutCubic 缓动
                    const eased = 1 - Math.pow(1 - progress, 3);
                    const current = Math.floor(eased * target);

                    el.textContent = current + (target > 10 ? suffix : '');

                    if (progress < 1) {
                        requestAnimationFrame(update);
                    } else {
                        el.textContent = target + (target > 10 ? suffix : '');
                    }
                }

                requestAnimationFrame(update);
                observer.unobserve(el);
            }
        });
    }, { threshold: 0.5 });

    statNumbers.forEach(function(el) {
        observer.observe(el);
    });
}

// ===== 滚动渐显动画 =====
function initScrollReveal() {
    const aosElements = document.querySelectorAll('[data-aos]');
    if (aosElements.length === 0) return;

    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            if (entry.isIntersecting) {
                entry.target.classList.add('aos-visible');
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    });

    aosElements.forEach(function(el) {
        observer.observe(el);
    });
}

// ===== 导航栏滚动效果 =====
function initNavScroll() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    window.addEventListener('scroll', function() {
        if (window.scrollY > 50) {
            navbar.style.boxShadow = '0 4px 30px rgba(0, 0, 0, 0.5)';
        } else {
            navbar.style.boxShadow = 'none';
        }
    });
}
