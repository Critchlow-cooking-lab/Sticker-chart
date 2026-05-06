# Bedtime Tracker — Setup on Raspberry Pi 500

## What you need

- Raspberry Pi 500 (connected to screen, keyboard, and internet)
- The `bedtime-tracker` folder (this folder)

## Step 1: Copy the project to your Pi

Copy the entire `bedtime-tracker` folder onto your Pi 500. You can:

- **USB stick**: Copy the folder to a USB drive, plug it into the Pi, then copy to your home folder
- **Network**: If both machines are on the same WiFi, use a file share or SCP

Put it somewhere simple like `/home/pi/bedtime-tracker` (or whatever your username is — on Pi 500 it might be the name you chose during setup).

To check your username, open a Terminal on the Pi and type:
```
whoami
```

Then copy the folder there:
```
cp -r /media/pi/USBDRIVE/bedtime-tracker ~/bedtime-tracker
```

## Step 2: Install Node.js

Open Terminal on the Pi and run:

```
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Check it worked:
```
node --version
npm --version
```

You should see version numbers (v20.x.x or similar).

## Step 3: Install dependencies

```
cd ~/bedtime-tracker
npm install
```

This downloads Express and the WebSocket library. Takes about 30 seconds.

## Step 4: Test it

```
npm start
```

You should see:
```
Bedtime Tracker running at http://localhost:3000
Kids: Elodie (key: 1), Samuel (key: 2)
Tasks: Brush teeth, Feed the dogs, Get into PJs, Make bed, Pack toys away
Reward target: 50 stars
```

Open Chromium on the Pi and go to `http://localhost:3000`. You should see the tracker with both kids' names and the task list.

Press `1` on the keyboard — Elodie's first task should get a star. Press `2` for Samuel.

Press `Ctrl+C` in the terminal to stop the server when you're done testing.

## Step 5: Make it start automatically on boot

This makes the tracker launch every time the Pi turns on — no need to open Terminal.

Create a service file:
```
sudo nano /etc/systemd/system/bedtime-tracker.service
```

Paste this (replace YOUR_USERNAME with your actual username from Step 1):
```
[Unit]
Description=Bedtime Star Tracker
After=network.target

[Service]
ExecStart=/usr/bin/node /home/YOUR_USERNAME/bedtime-tracker/server.js
WorkingDirectory=/home/YOUR_USERNAME/bedtime-tracker
Restart=always
User=YOUR_USERNAME
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Save: `Ctrl+O`, then `Enter`, then `Ctrl+X` to exit.

Enable and start it:
```
sudo systemctl enable bedtime-tracker
sudo systemctl start bedtime-tracker
```

Check it's running:
```
sudo systemctl status bedtime-tracker
```

## Step 6: Launch Chromium in kiosk mode on boot

This opens the tracker fullscreen when the Pi starts — no desktop, no toolbar, just the star board.

```
mkdir -p ~/.config/autostart
nano ~/.config/autostart/bedtime-kiosk.desktop
```

Paste:
```
[Desktop Entry]
Type=Application
Name=Bedtime Kiosk
Exec=chromium-browser --kiosk --noerrdialogs --disable-infobars --no-first-run http://localhost:3000
X-GNOME-Autostart-enabled=true
```

Save and exit (`Ctrl+O`, `Enter`, `Ctrl+X`).

Reboot to test:
```
sudo reboot
```

The Pi should boot straight into the tracker fullscreen.

To exit kiosk mode: press `Alt+F4` or `Ctrl+Alt+T` to get a terminal.

## Step 7: Connect from a tablet (optional wall display)

If you want to mount a tablet on the bedroom wall:

1. Find your Pi's IP address: open Terminal and type `hostname -I`
2. On the tablet's browser, go to `http://YOUR_PI_IP:3000`
3. The tablet shows the same tracker — updates in real time via WebSocket

## Later: Connect Flic 2 buttons

When your Flic buttons arrive:

1. Pair each Flic 2 button with the Flic Hub
2. In the Flic Hub app, set each button's action to "Internet Request":
   - Elodie's button: `POST http://YOUR_PI_IP:3000/api/button/elodie`
   - Samuel's button: `POST http://YOUR_PI_IP:3000/api/button/samuel`
3. The buttons now work alongside (or instead of) the keyboard

## Editing the routine

Open `config.js` in any text editor to change:

- **Kid names**: Edit the `kids` array
- **Tasks**: Edit `defaultTasks`
- **Day-specific tasks**: Edit `dayOverrides` (0=Sunday through 6=Saturday)
- **Reward target**: Change `rewardTarget` (currently 50)
- **Reset time**: Change `resetHour` (currently 16 = 4pm)

After editing, restart the service:
```
sudo systemctl restart bedtime-tracker
```

## Troubleshooting

**Server won't start**: Run `node server.js` manually from the bedtime-tracker folder to see error messages.

**Can't connect from tablet**: Make sure the Pi and tablet are on the same WiFi network. Check the Pi's firewall isn't blocking port 3000.

**Tasks didn't reset**: The task list refreshes at 4pm (set by `resetHour` in config.js). If it's before 4pm, you're still seeing last night's board. You can manually reset by visiting `http://localhost:3000/api/reset` in a browser (POST request).

**Stars seem wrong**: Check `data.json` in the project folder — this is the database. You can edit it manually or delete it to start fresh.
