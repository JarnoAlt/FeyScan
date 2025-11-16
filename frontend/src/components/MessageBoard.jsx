/* === Message Board – Premium Glass Panel Upgrade === */
.message-board {
  background: radial-gradient(circle at top left, rgba(15, 23, 42, 0.96), rgba(0, 0, 0, 0.98));
  border: 1px solid rgba(22, 163, 74, 0.7);
  border-radius: 16px;
  padding: 1.5rem;
  color: #e5e7eb;
  box-shadow:
    0 18px 40px rgba(0, 0, 0, 0.92),
    0 0 18px rgba(22, 163, 74, 0.4);
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* === Header / Subtitle === */
.message-board-header {
  border-bottom: 1px solid rgba(22, 163, 74, 0.4);
  padding-bottom: 0.75rem;
  margin-bottom: 0.5rem;
}

.message-board-header h3 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
  color: #bbf7d0;
  text-shadow:
    0 0 10px rgba(22, 163, 74, 0.5),
    0 0 22px rgba(22, 163, 74, 0.3);
}

.message-board-subtitle {
  margin: 0.25rem 0 0;
  font-size: 0.85rem;
  color: #9ca3af;
}

/* === Connect Notice === */
.message-board-connect {
  background: rgba(15, 23, 42, 0.9);
  border-radius: 12px;
  padding: 0.75rem 1rem;
  border: 1px dashed rgba(148, 163, 184, 0.7);
}

.message-board-connect p {
  margin: 0;
  font-size: 0.9rem;
  color: #e5e7eb;
}

/* === Buttons (primary / secondary) === */
.message-board-button {
  border-radius: 999px;
  padding: 0.6rem 1.3rem;
  border: 1px solid rgba(22, 163, 74, 0.85);
  background: radial-gradient(circle at top left, rgba(22, 163, 74, 0.16), rgba(0, 0, 0, 0.96));
  color: #bbf7d0;
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  box-shadow: 0 10px 22px rgba(22, 163, 74, 0.35);
  transition: all 0.18s ease;
}

.message-board-button:hover {
  background: linear-gradient(135deg, #22c55e, #16a34a);
  color: #000000;
  transform: translateY(-1px) scale(1.01);
}

.message-board-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}

/* primary / secondary variants */
.message-board-button.primary {
  background: linear-gradient(135deg, #22c55e, #16a34a);
  color: #000000;
}

.message-board-button.primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #4ade80, #22c55e);
}

.message-board-button.secondary {
  background: rgba(15, 23, 42, 0.96);
  color: #e5e7eb;
  border-color: rgba(148, 163, 184, 0.9);
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.9);
}

.message-board-button.secondary:hover:not(:disabled) {
  background: rgba(31, 41, 55, 0.95);
}

/* === Form Wrapper === */
.message-board-form {
  margin-top: 0.5rem;
  padding: 1rem;
  border-radius: 14px;
  background: radial-gradient(circle at top, rgba(15, 23, 42, 0.98), rgba(0, 0, 0, 0.98));
  border: 1px solid rgba(22, 163, 74, 0.65);
  box-shadow:
    0 14px 32px rgba(0, 0, 0, 0.92),
    0 0 16px rgba(22, 163, 74, 0.3);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

/* === Textarea === */
.message-board-textarea {
  width: 100%;
  border-radius: 12px;
  border: 1px solid rgba(22, 163, 74, 0.8);
  background: #020617;
  color: #e5e7eb;
  padding: 0.75rem 0.9rem;
  font-size: 0.9rem;
  resize: vertical;
  min-height: 96px;
  box-shadow: 0 0 18px rgba(22, 163, 74, 0.3);
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}

.message-board-textarea::placeholder {
  color: #6b7280;
}

.message-board-textarea:focus {
  outline: none;
  border-color: #4ade80;
  background: #020617;
  box-shadow: 0 0 22px rgba(22, 163, 74, 0.6);
}

/* === Payment Info === */
.message-board-payment-info {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.5rem;
  align-items: center;
  justify-content: space-between;
  font-size: 0.85rem;
  color: #d1d5db;
}

.message-board-payment-info strong {
  color: #bbf7d0;
}

.eth-price {
  font-size: 0.8rem;
  color: #9ca3af;
}

/* === Error Messages === */
.message-board-error {
  margin-top: 0.25rem;
  border-radius: 10px;
  padding: 0.5rem 0.75rem;
  font-size: 0.8rem;
  color: #fee2e2;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.7);
}

/* === Form Actions Row === */
.message-board-actions {
  margin-top: 0.5rem;
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  flex-wrap: wrap;
}

/* === Messages List Wrapper === */
.message-board-list {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid rgba(31, 41, 55, 0.9);
}

.message-board-list h4 {
  margin: 0 0 0.5rem;
  font-size: 0.95rem;
  color: #bbf7d0;
}

/* === Empty State === */
.no-messages {
  margin: 0.5rem 0 0;
  font-size: 0.85rem;
  color: #6b7280;
}

/* === Messages Scroll Area === */
.messages {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 260px;
  overflow-y: auto;
  padding-right: 0.25rem;
}

/* === Individual Message Card === */
.message-item {
  border-radius: 12px;
  padding: 0.6rem 0.75rem;
  background: rgba(15, 23, 42, 0.96);
  border: 1px solid rgba(31, 41, 55, 0.95);
  transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease;
}

.message-item:hover {
  border-color: rgba(22, 163, 74, 0.7);
  background: rgba(15, 23, 42, 1);
  transform: translateY(-1px);
}

/* Header (address + date) */
.message-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.25rem;
  font-size: 0.8rem;
}

.message-sender {
  font-weight: 600;
  color: #bbf7d0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.message-time {
  color: #9ca3af;
  font-size: 0.75rem;
}

/* Body text */
.message-content {
  font-size: 0.86rem;
  line-height: 1.4;
  color: #e5e7eb;
  word-wrap: break-word;
}

/* === Mobile tweaks === */
@media (max-width: 640px) {
  .message-board {
    padding: 1.1rem;
    border-radius: 14px;
  }

  .message-board-actions {
    justify-content: stretch;
  }

  .message-board-button {
    width: 100%;
  }

  .message-board-payment-info {
    flex-direction: column;
    align-items: flex-start;
  }

  .messages {
    max-height: 220px;
  }
}
