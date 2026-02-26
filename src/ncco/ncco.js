export function initialNCCO(baseUrl) {
  const wsUrl = baseUrl.replace("https://", "wss://").replace("http://", "ws://");

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
    },
    {
      action: "input",
      type: ["speech"],
      speech: {
        language: "en-US",
        endOnSilence: 2.5,
        maxDuration: 60,
        startTimeout: 15,
        sensitivity: 75,
        saveAudio: false
      },
      eventUrl: [`${baseUrl}/webhooks/asr`],
      eventMethod: "POST"
    }
  ];
}

export function continueListeningNCCO(baseUrl) {
  return [
    {
      action: "input",
      type: ["speech"],
      speech: {
        language: "en-US",
        endOnSilence: 2.5,
        maxDuration: 60,
        startTimeout: 15,
        sensitivity: 75,
        saveAudio: false
      },
      eventUrl: [`${baseUrl}/webhooks/asr`],
      eventMethod: "POST"
    }
  ];
}