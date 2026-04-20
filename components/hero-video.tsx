export default function HeroVideo() {
  return (
    <div className="relative w-full max-w-xl rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
      <video
        src="/demo/zorelan-ai-safety-demo-v1.mp4"
        autoPlay
        muted
        loop
        playsInline
        className="w-full h-auto"
      />

      <div className="absolute bottom-4 left-4 right-4 bg-black/70 text-white text-sm px-4 py-2 rounded-lg backdrop-blur">
        AI triggered refund ❌
        <br />
        Zorelan BLOCKED it <span className="text-green-400 font-semibold">✅</span>
      </div>
    </div>
  );
}
