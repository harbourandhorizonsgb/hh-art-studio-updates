#!/bin/sh
# Harbour & Horizons posting box – installs (or updates) the helper on an always-on Linux box.
# Run on the box:  curl -fsSL https://raw.githubusercontent.com/harbourandhorizonsgb/hh-art-studio-updates/main/box-install.sh | sudo sh
set -eu
BASE="https://raw.githubusercontent.com/harbourandhorizonsgb/hh-art-studio-updates/main"
U="${SUDO_USER:-$(id -un)}"
if [ "$U" = "root" ]; then echo "Please run this from your normal login with sudo (not as root)."; exit 1; fi
H="$(getent passwd "$U" | cut -d: -f6)"
D="$H/hhbox"
dl() { if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"; else wget -qO "$2" "$1"; fi; }
echo "Installing the Harbour & Horizons posting box for $U ..."
mkdir -p "$D"
dl "$BASE/latest.json?t=$(date +%s)" "$D/latest.json"
SHA="$(sed -n 's/.*"box_sha256": *"\([0-9a-f]*\)".*/\1/p' "$D/latest.json")"
dl "$BASE/hhbox-linux-amd64" "$D/hhbox.new"
GOT="$(sha256sum "$D/hhbox.new" | cut -d' ' -f1)"
if [ -z "$SHA" ] || [ "$GOT" != "$SHA" ]; then echo "The download did not match its checksum – nothing installed. Try again in a few minutes."; rm -f "$D/hhbox.new"; exit 1; fi
chmod 755 "$D/hhbox.new"
mv "$D/hhbox.new" "$D/hhbox"
chown -R "$U" "$D"
timedatectl set-timezone Europe/London 2>/dev/null || true
cat > /etc/systemd/system/hhbox.service <<UNIT
[Unit]
Description=Harbour & Horizons posting box
After=network-online.target
Wants=network-online.target

[Service]
User=$U
Environment=HOME=$H
ExecStart=$D/hhbox --box
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable hhbox >/dev/null 2>&1
systemctl restart hhbox
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  for n in 192.168.0.0/16 10.0.0.0/8 172.16.0.0/12; do ufw allow from "$n" to any port 8790 proto tcp >/dev/null; done
fi
sleep 3
echo
echo "Done – the posting box is running and starts by itself after a power cut."
echo "Its address:  $(hostname -I | awk '{print $1}')"
if [ -f "$H/.hhbox/pair_code.txt" ]; then
  echo "Pairing code: $(cat "$H/.hhbox/pair_code.txt")"
else
  echo "Already paired. For a new pairing code run:  $D/hhbox --box-pair"
fi
echo "Type both into the Art Studio: 3. Share → Posting box."
