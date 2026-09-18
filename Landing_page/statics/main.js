// alert("TutorAI JavaScript is working!");
const scene = document.getElementById("heroScene");

const thinkingText = document.getElementById("thinkingText");



scene.addEventListener("mousemove", function (event) {

    const rect = scene.getBoundingClientRect();

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateX = (y - centerY) / 35;
    const rotateY = (centerX - x) / 35;

    scene.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;

});


scene.addEventListener("mouseleave", function () {

    scene.style.transform = "rotateX(0deg) rotateY(0deg)";

});


// AI STATUS ANIMATION 

const messages = [
    "AI IS THINKING...",
    "PROF. QUEV IS TEACHING...",
    "LOOK AT THE WHITEBOARD...",
    "CONCEPT IS COMING TO LIFE..."
];

let messageIndex = 0;

setInterval(() => {

    messageIndex++;

    if (messageIndex >= messages.length) {
        messageIndex = 0;
    }

    thinkingText.textContent = messages[messageIndex];

}, 2500);


