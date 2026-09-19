const tracks = ['비디오 / 사진', '자막', '배경음악', '내레이션'];

export function TimelineShell() {
  return (
    <section className="timeline-shell" aria-labelledby="timeline-heading">
      <h2 id="timeline-heading">타임라인</h2>
      <div className="timeline-tracks">
        {tracks.map((track) => (
          <div className="timeline-track" key={track}>
            <span>{track}</span>
          </div>
        ))}
      </div>
    </section>
  );
}