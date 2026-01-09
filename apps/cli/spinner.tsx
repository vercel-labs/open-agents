import React from "react";
import { render, Text, Box } from "ink";
import Spinner from "ink-spinner";

interface SpinnerUIProps {
  message: string;
}

function SpinnerUI({ message }: SpinnerUIProps) {
  return (
    <Box>
      <Text color="cyan">
        <Spinner type="dots" />
      </Text>
      <Text> {message}</Text>
    </Box>
  );
}

export function showSpinner(message: string) {
  const { unmount, rerender } = render(<SpinnerUI message={message} />);

  return {
    update(newMessage: string) {
      rerender(<SpinnerUI message={newMessage} />);
    },
    stop() {
      unmount();
    },
  };
}
