// WebSocket connection handler for D&D Beyond
export class DDBWebSocket extends EventTarget {
  constructor(cobaltCookie, campaignId, userId, proxyUrl, proxyUser = null, proxyPass = null) {
    super();
    this.accessToken = null;
    this.cobaltCookie = cobaltCookie;
    this.campaignId = campaignId;
    this.userId = userId;
    this.proxyUrl = proxyUrl;
    this.proxyUser = proxyUser; // New
    this.proxyPass = proxyPass; // New
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 3000;
    this._listeners = {};  
  }

  /**
   * Fetch the access token from DDB auth service using the CobaltSession cookie
   * Uses a proxy to avoid CORS issues
   * @returns {Promise<string|null>} The access token or null if failed
   */
  async fetchAccessToken() {
    try {
      console.log('DDB Sync | Fetching access token via proxy...');
      
      // Use the proxy to bypass CORS restrictions
      const proxyEndpoint = `${this.proxyUrl}/proxy/auth`;
      
      // Prepare headers
      const headers = {
        'Content-Type': 'application/json'
      };

      // NEW: Add Authorization header if credentials exist
      if (this.proxyUser && this.proxyPass) {
        const auth = btoa(`${this.proxyUser}:${this.proxyPass}`);
        headers['Authorization'] = `Basic ${auth}`;
      }

      const response = await fetch(proxyEndpoint, {
        method: 'POST',
        headers: headers, // Use the updated headers object
        body: JSON.stringify({
          cobalt: this.cobaltCookie
        })
      });

/*      const response = await fetch(proxyEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          cobalt: this.cobaltCookie
        })
      });
*/
      if (!response.ok) {
        // Check for authentication failure (401, 403)
        if (response.status === 401 || response.status === 403) {
          console.error('DDB Sync | CobaltSession cookie expired or invalid (HTTP ' + response.status + ')');
          this.dispatchEvent(new CustomEvent('cookieExpired'));
          return null;
        }
        console.error('DDB Sync | Failed to fetch access token:', response.status, response.statusText);
        return null;
      }

      const data = await response.json();
      
      if (data.token) {
        console.log('DDB Sync | Access token obtained successfully');
        return data.token;
      } else {
        console.error('DDB Sync | No token in response:', data);
        return null;
      }
    } catch (err) {
      console.error('DDB Sync | Error fetching access token:', err);
      return null;
    }
  }

  async connect() {
    try {
      // First, fetch the access token using the CobaltSession cookie
      this.accessToken = await this.fetchAccessToken();
      
      if (!this.accessToken) {
        ui.notifications.error('DDB Sync: Failed to authenticate with D&D Beyond. Check your CobaltSession cookie.');
        return;
      }

      // DDB WebSocket endpoint
      const wsUrl = `wss://game-log-api-live.dndbeyond.com/v1?gameId=${this.campaignId}&userId=${this.userId}&stt=${this.accessToken}`;
      
      console.log('DDB Sync | Connecting to WebSocket...');
      
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => this.onOpen();
      this.ws.onmessage = (event) => this.onMessage(event);
      this.ws.onerror = (error) => this.onError(error);
      this.ws.onclose = (event) => this.onClose(event);
      
    } catch (err) {
      console.error('DDB Sync | Connection error:', err);
      this.scheduleReconnect();
    }
  }

  onOpen() {
    console.log('DDB Sync | WebSocket connected');
    this.reconnectAttempts = 0;
    
    // Send authentication message
    this.authenticate();
    
    // Dispatch connected event
    this.dispatchEvent(new CustomEvent('connected'));
  }

  authenticate() {
    // Send authentication with access token
    const authMessage = {
      type: 'authenticate',
      data: {
        token: this.accessToken,
        campaignId: this.campaignId
      }
    };
    
    this.send(authMessage);
  }

  onMessage(event) {
    try {
      const message = JSON.parse(event.data);
      console.log('DDB Sync | Message received:', message);

      // Handle different message types
      switch (message.eventType) {
        case 'authenticated':
          console.log('DDB Sync | Authentication successful');
          this.subscribeToCharacterUpdates();
          break;

        case 'dice/roll/fulfilled':
          // Preserve eventType in the data so handleDDBMessage can recognize it
          const diceData = message.data || message;
          diceData.eventType = message.eventType;
          diceData.id = message.rollId;
          this.dispatchEvent(new CustomEvent('message', { detail: diceData }));
          break;

        case 'character-sheet/character-update':
        case 'character-sheet/character-update/fulfilled':
          // Preserve eventType in the data so handleDDBMessage can recognize it
          const charData = message.data || message;
          charData.eventType = message.eventType;
          charData.id = message.id;
          this.dispatchEvent(new CustomEvent('message', { detail: charData }));
          break;

        default:
          console.log('DDB Sync | Unprocessed message type:', message.eventType);
      }
    } catch (err) {
      console.error('DDB Sync | Failed to parse message:', err);
    }
  }

  subscribeToCharacterUpdates() {
    // Subscribe to character update events
    const subscribeMessage = {
      type: 'subscribe',
      data: {
        event: 'character.update',
        campaignId: this.campaignId
      }
    };
    
    this.send(subscribeMessage);
    console.log('DDB Sync | Subscribed to character updates');
  }

  onError(error) {
    console.error('DDB Sync | WebSocket error:', error);
  }

  onClose(event) {
    console.log('DDB Sync | WebSocket closed:', event.code, event.reason);
    
    this.dispatchEvent(new CustomEvent('disconnected'));
    
    // Attempt to reconnect unless it was a clean close
    if (event.code !== 1000) {
      this.scheduleReconnect();
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = typeof data === 'string' ? data : JSON.stringify(data);
      this.ws.send(message);
    } else {
      console.warn('DDB Sync | Cannot send message, WebSocket not open');
    }
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('DDB Sync | Max reconnection attempts reached');
      ui.notifications.error('Failed to connect to D&D Beyond after multiple attempts');
      return;
    }
    
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;
    
    console.log(`DDB Sync | Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close(1000, 'Manual disconnect');
      this.ws = null;
    }
  }

  // Helper to listen to events
  on(eventName, callback) {
    // Store the bound function so we can remove it later
    if (!this._listeners[eventName]) {
      this._listeners[eventName] = [];
    }
    const boundCallback = (e) => callback(e.detail);
    this._listeners[eventName].push(boundCallback);
    this.addEventListener(eventName, boundCallback);
  }

  // Helper to remove all event listeners
  removeAllListeners() {
    // Remove all registered listeners
    for (const [eventName, callbacks] of Object.entries(this._listeners)) {
      callbacks.forEach(callback => {
        this.removeEventListener(eventName, callback);
      });
    }
    this._listeners = {};
  }
}
