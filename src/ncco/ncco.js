export function initialNCCO(baseUrl) {
  const wsUrl = baseUrl
    .replace("https://", "wss://")
    .replace("http://", "ws://");

  return [
    {
      action: "connect",
      endpoint: [
        {
          type: "websocket",
          uri: `${wsUrl}/ws/vonage`,
          "content-type": "audio/l16;rate=16000",
          headers: {}
        }
      ]
    }
  ];
}

export function continueListeningNCCO(baseUrl) {
  return [];
}
