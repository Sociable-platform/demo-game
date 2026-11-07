// Edit this object to configure the SDK chat. Colors must be six-digit hex.

export const chatConfig = {
  schemaVersion: 1,
  layout: {
    mode: 'floating',
    position: 'bottom-right',
    width: 340,
    height: 360,
  },
  theme: {
    primaryColor: '#527A3A',
    backgroundColor: '#FFF8EA',
    textColor: '#342C22',
    borderRadius: 16,
  },
  tabs: [
    { id: 'chats', label: 'Village chat', icon: 'message-circle', enabled: true, order: 0 },
  ],
};
