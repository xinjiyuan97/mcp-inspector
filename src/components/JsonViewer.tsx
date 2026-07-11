import { useState } from "react";
import Editor from "@monaco-editor/react";

export default function JsonViewer({
  value,
  maxHeight = "400px",
}: {
  value: any;
  maxHeight?: string;
}) {
  const [copied, setCopied] = useState(false);

  const jsonStr = typeof value === "string" ? value : JSON.stringify(value, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonStr);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative min-w-0 overflow-hidden border border-neutral-700 rounded" style={{ maxHeight }}>
      <button
        onClick={handleCopy}
        className="absolute top-1 right-1 z-10 px-2 py-0.5 text-xs bg-neutral-700 hover:bg-neutral-600 rounded"
      >
        {copied ? "已复制" : "复制"}
      </button>
      <Editor
        height={maxHeight}
        defaultLanguage="json"
        value={jsonStr}
        theme="vs-dark"
        options={{
          readOnly: true,
          minimap: { enabled: false },
          fontSize: 12,
          lineNumbers: "off",
          scrollBeyondLastLine: false,
          wordWrap: "off",
          folding: true,
          scrollbar: {
            horizontal: "auto",
            vertical: "auto",
            handleMouseWheel: true,
          },
          overviewRulerLanes: 0,
        }}
      />
    </div>
  );
}
