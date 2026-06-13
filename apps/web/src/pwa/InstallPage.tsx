/**
 * iOS Add-to-Home-Screen instructions (F804).
 * Shown at /install — linked from settings and the first-run banner.
 */
import './install.css';

export function InstallPage() {
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in window.navigator &&
      (window.navigator as { standalone?: boolean }).standalone === true);

  if (isStandalone) {
    return (
      <div className="install-page">
        <div className="install-card">
          <div className="install-icon">📖</div>
          <h1>Fables is installed!</h1>
          <p>You're running Fables as a home screen app. Enjoy the full experience.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="install-page">
      <div className="install-card">
        <div className="install-icon">📖</div>
        <h1>Add Fables to your Home Screen</h1>
        <p>For the best experience on iPhone, install Fables as a home screen app:</p>

        <ol className="install-steps">
          <li>
            <span className="install-step-num">1</span>
            <div>
              <strong>Tap the Share button</strong>
              <p>
                In Safari, tap <span className="install-key">⎋ Share</span> at the bottom of the
                screen.
              </p>
            </div>
          </li>
          <li>
            <span className="install-step-num">2</span>
            <div>
              <strong>Add to Home Screen</strong>
              <p>
                Scroll down in the Share sheet and tap{' '}
                <span className="install-key">Add to Home Screen</span>.
              </p>
            </div>
          </li>
          <li>
            <span className="install-step-num">3</span>
            <div>
              <strong>Confirm</strong>
              <p>
                Tap <span className="install-key">Add</span> in the top right corner.
              </p>
            </div>
          </li>
        </ol>

        <div className="install-benefits">
          <h2>What you get</h2>
          <ul>
            <li>✓ Full-screen, no browser chrome</li>
            <li>✓ Works offline — notes saved locally</li>
            <li>✓ App shortcuts from the home screen</li>
            <li>✓ Share web pages directly to Fables</li>
          </ul>
        </div>

        <p className="install-note">
          <strong>Note:</strong> This requires Safari on iOS. Chrome on iOS cannot install PWAs.
        </p>
      </div>
    </div>
  );
}
