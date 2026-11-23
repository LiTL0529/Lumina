const app = getApp();

Page({
  data: {
    token: '',
    loading: false,
    result: null,
  },

  /**
   * Supports WeChat "Scan Standard URL QR Code to Open Mini Program":
   * WeChat passes the scanned URL in `options.q` (URI-encoded).
   */
  onLoad(options) {
    let raw = options.token || '';
    if (!raw && options.q) {
      const decodedUrl = decodeURIComponent(options.q);
      const match = decodedUrl.match(/\/v\/([0-9A-Za-z]{16})/);
      if (match) raw = match[1];
    }
    if (raw) {
      this.setData({ token: raw });
      this.verifyToken(raw);
    }
  },

  onScanTap() {
    wx.scanCode({
      onlyFromCamera: false,
      success: (res) => {
        const match = (res.result || '').match(/([0-9A-Za-z]{16})$/);
        const token = match ? match[1] : res.result;
        this.setData({ token });
        this.verifyToken(token);
      },
    });
  },

  verifyToken(token) {
    this.setData({ loading: true });
    wx.request({
      url: `${app.globalData.apiBase}/public/verify/${encodeURIComponent(token)}`,
      method: 'GET',
      success: (res) => {
        this.setData({ result: res.data, loading: false });
      },
      fail: () => {
        this.setData({ loading: false });
        wx.showToast({ title: '网络异常，请重试', icon: 'none' });
      },
    });
  },

  goWorkbench() {
    wx.navigateTo({ url: '/pages/workbench/index' });
  },
});
