export function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <div class="stack">
      <h1>{title}</h1>
      <section class="panel">
        <p>{text}</p>
      </section>
    </div>
  );
}
