from ..base import BaseMigration


class V015PlatformNormalize(BaseMigration):
    version = 15
    description = "Normalize legacy platform values (desktop -> webapp-desktop, mobile -> webapp-mobile, pwa -> pwa-mobile)"

    def up(self, conn):
        cur = conn.cursor()
        cur.execute("UPDATE user_actions SET platform = 'webapp-desktop' WHERE platform = 'desktop'")
        cur.execute("UPDATE user_actions SET platform = 'webapp-mobile' WHERE platform = 'mobile'")
        cur.execute("UPDATE user_actions SET platform = 'pwa-mobile' WHERE platform = 'pwa'")
