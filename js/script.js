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

    // 2. FAQ Accordion
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

    // 4. Contact Modal Logic
    const modal = document.getElementById('contact-modal');
    const heroBtn = document.getElementById('hero-cta-btn');
    const footerBtn = document.getElementById('footer-cta-btn');
    const closeBtn = document.getElementById('modal-close-btn');
    const form = document.getElementById('consultation-form');
    const successMsg = document.getElementById('form-success');
    const successCloseBtn = document.getElementById('success-close-btn');

    function openModal() {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
    }

    function closeModal() {
        modal.classList.remove('active');
        document.body.style.overflow = '';

        // Reset form state after modal closes
        setTimeout(() => {
            form.style.display = 'block';
            successMsg.style.display = 'none';
            form.reset();
        }, 400);
    }

    if (heroBtn) heroBtn.addEventListener('click', openModal);
    if (footerBtn) footerBtn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (successCloseBtn) successCloseBtn.addEventListener('click', closeModal);

    // Close modal on outside click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });

    // Handle form submission (Mock logic for now, waiting for backend handler setup)
    form.addEventListener('submit', (e) => {
        e.preventDefault();

        // Change button state to loading
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.textContent = '送信中...';
        submitBtn.disabled = true;

        // Simulate network request
        setTimeout(() => {
            // Hide form, show success message
            form.style.display = 'none';
            successMsg.style.display = 'block';

            // Revert button state
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }, 800);
    });
});
