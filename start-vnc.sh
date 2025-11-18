#!/bin/bash
set -ex

export DISPLAY=:1
export RESOLUTION=1920x1080
export DEPTH=24

# Dynamically set timezone if provided
if [ -n "$TZ" ]; then
    echo "Setting timezone to $TZ"
    ln -snf "/usr/share/zoneinfo/$TZ" /etc/localtime
    echo "$TZ" > /etc/timezone
    dpkg-reconfigure -f noninteractive tzdata
fi

# Generate a new machine ID if needed
if [ ! -s /etc/machine-id ]; then
    echo "Generating a new machine ID..."
    dbus-uuidgen > /etc/machine-id
fi

# Start D-Bus
mkdir -p /var/run/dbus
rm -f /var/run/dbus/pid
dbus-daemon --system --fork

# Create .Xauthority file for puppeteer user
touch /home/puppeteer/.Xauthority
chown puppeteer:puppeteer /home/puppeteer/.Xauthority

# Set up VNC xstartup script for puppeteer user
mkdir -p /home/puppeteer/.vnc
cat << 'EOF' > /home/puppeteer/.vnc/xstartup
#!/bin/bash
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
[ -r $HOME/.Xresources ] && xrdb $HOME/.Xresources
dbus-launch --exit-with-session startxfce4
EOF
chmod +x /home/puppeteer/.vnc/xstartup
chown -R puppeteer:puppeteer /home/puppeteer/.vnc

# Set up VNC password non-interactively for puppeteer user
su puppeteer -c 'echo "yourpassword" | tigervncpasswd -f > $HOME/.vnc/passwd'
chmod 600 /home/puppeteer/.vnc/passwd
chown puppeteer:puppeteer /home/puppeteer/.vnc/passwd

# Kill any existing VNC sessions
su puppeteer -c "tigervncserver -kill $DISPLAY" || true

# Start VNC server as puppeteer user with specified security types
su puppeteer -c 'tigervncserver $DISPLAY -geometry $RESOLUTION -depth $DEPTH -rfbauth $HOME/.vnc/passwd -SecurityTypes VncAuth -localhost no &'

# Wait for the X server to start
for i in {1..10}; do
    if su puppeteer -c "xdpyinfo -display $DISPLAY >/dev/null 2>&1"; then
        echo "X server is ready"
        break
    else
        echo "Waiting for X server..."
        sleep 1
    fi
done

# Create writable font cache directory for puppeteer user
mkdir -p /home/puppeteer/.cache/fontconfig
chown -R puppeteer:puppeteer /home/puppeteer/.cache

# Set FONTCONFIG environment variables
export FONTCONFIG_PATH=/etc/fonts
export FONTCONFIG_FILE=/etc/fonts/fonts.conf
export FONTCONFIG_CACHE=/home/puppeteer/.cache/fontconfig

# Run the Node.js application as puppeteer user
# Use the BUILD_TARGET environment variable to choose the command
if [ "$BUILD_TARGET" = "prod" ]; then
    su puppeteer -c 'cd /app && npm run dev_exec:prod'
else
    su puppeteer -c 'cd /app && npm run dev_exec:dev'
fi

# Keep the script running
wait
