// A URL ends before closing punctuation, so "see https://bahn.de." links to bahn.de.
export const URL_PATTERN = /(https:\/\/[^\s)\]]*[^\s)\].,;:!?'"])/g;

/** Renders plain text with line breaks and clickable https links (no HTML from the model). */
export function Linkify({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => (
        <span key={i} className="block min-h-[1em]">
          {line.split(URL_PATTERN).map((part, j) =>
            part.startsWith('https://') ? (
              <a
                key={j}
                href={part}
                target="_blank"
                rel="noreferrer"
                className="break-all underline"
              >
                {part}
              </a>
            ) : (
              part
            ),
          )}
        </span>
      ))}
    </>
  );
}
