export function PreviewPanel() {
  return (
    <section className="panel preview-panel" aria-labelledby="preview-heading">
      <h2 id="preview-heading">미리보기</h2>
      <div className="preview-frame">
        <button type="button" className="preview-placeholder">재생 placeholder</button>
      </div>
    </section>
  );
}