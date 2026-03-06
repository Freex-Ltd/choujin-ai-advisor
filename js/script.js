document.addEventListener('DOMContentLoaded', () => {
    // 1. Reveal Elements on Scroll using IntersectionObserver
    const revealElements = document.querySelectorAll('.reveal');

    const revealOptions = {
        threshold: 0.15,
        rootMargin: "0px 0px -50px 0px"
    };

    const revealOnScroll = new IntersectionObserver(function (entries, observer) {
        entries.forEach(entry => {
            if (!entry.isIntersecting) {
                return;
            } else {
                entry.target.classList.add('active');
                observer.unobserve(entry.target);
            }
        });
    }, revealOptions);

    revealElements.forEach(el => {
        revealOnScroll.observe(el);
    });

    // Handle immediate load reveal for hero
    setTimeout(() => {
        const hero = document.getElementById('hero');
        if (hero) hero.classList.add('active');
    }, 100);

    // 2. Header Navigation - show/hide on scroll
    const header = document.getElementById('site-header');
    const hamburger = document.getElementById('hamburger');
    const headerNav = document.getElementById('header-nav');
    let lastScrollY = 0;

    if (header) {
        window.addEventListener('scroll', () => {
            const currentScrollY = window.scrollY;
            const heroHeight = document.getElementById('hero')?.offsetHeight || 500;

            // Show header after scrolling past hero
            if (currentScrollY > heroHeight * 0.5) {
                header.classList.add('visible', 'scrolled');
            } else {
                header.classList.remove('visible', 'scrolled');
            }

            lastScrollY = currentScrollY;
        });
    }

    // Hamburger menu toggle
    if (hamburger && headerNav) {
        hamburger.addEventListener('click', () => {
            const isOpen = headerNav.classList.toggle('open');
            hamburger.classList.toggle('active');
            hamburger.setAttribute('aria-expanded', isOpen);
            hamburger.setAttribute('aria-label', isOpen ? 'メニューを閉じる' : 'メニューを開く');
        });

        // Close menu when a nav link is clicked
        headerNav.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', () => {
                headerNav.classList.remove('open');
                hamburger.classList.remove('active');
                hamburger.setAttribute('aria-expanded', 'false');
                hamburger.setAttribute('aria-label', 'メニューを開く');
            });
        });
    }

    // 3. FAQ Accordion
    const faqItems = document.querySelectorAll('.faq-item');

    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        const answer = item.querySelector('.faq-answer');

        question.addEventListener('click', () => {
            const isActive = item.classList.contains('active');

            // Close all other items
            faqItems.forEach(otherItem => {
                otherItem.classList.remove('active');
                otherItem.querySelector('.faq-answer').style.maxHeight = null;
            });

            // Toggle current item
            if (!isActive) {
                item.classList.add('active');
                answer.style.maxHeight = answer.scrollHeight + 'px';
            }
        });
    });

    // 3. Smooth Scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;

            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                targetElement.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // 4. Contact Form Logic
    const form = document.getElementById('consultation-form');
    const successMsg = document.getElementById('form-success');

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            // Change button state to loading
            const submitBtn = form.querySelector('button[type="submit"]');
            const originalText = submitBtn.textContent;
            submitBtn.textContent = '送信中...';
            submitBtn.disabled = true;

            const formData = new URLSearchParams(new FormData(form));

            try {
                const response = await fetch('/', {
                    method: 'POST',
                    body: formData,
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                });

                if (response.ok) {
                    // Hide form, show success message
                    form.style.display = 'none';
                    successMsg.style.display = 'block';
                } else {
                    alert('送信に失敗しました。時間をおいて再度お試しください。');
                }
            } catch (error) {
                console.error('Error submitting form:', error);
                alert('通信エラーが発生しました。ネットワーク環境をご確認ください。');
            } finally {
                // Revert button state
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
            }
        });
    }
});
