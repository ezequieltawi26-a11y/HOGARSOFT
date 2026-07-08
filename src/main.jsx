import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
requestAnimationFrame(() => {
  const s = document.getElementById("splash");
  if (s) s.remove();
});
