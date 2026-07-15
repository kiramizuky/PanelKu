# LVM Manager Plugin

Plugin untuk mengelola **Logical Volume Manager (LVM)** dari panel PanelKu. Cocok untuk mini server dengan lebih dari 1 drive/disk.

## Fitur

| Fitur | Deskripsi |
|-------|-----------|
| 📊 **Block Device Overview** | Tampilkan semua disk yang terdeteksi (sda, sdb, nvme0, dst.) |
| 🔶 **Physical Volumes (PV)** | Lihat semua PV beserta ukuran dan free space |
| 🔵 **Volume Groups (VG)** | Lihat VG, jumlah PV/LV, dan usage bar |
| 🟢 **Logical Volumes (LV)** | Lihat semua LV beserta mount point |
| ➕ **Initialize Disk** | Jalankan `pvcreate` + opsional `vgextend` |
| ➕ **Add Disk to VG** | Tambah disk baru ke Volume Group yang ada |
| ↔️ **Extend LV** | Perbesar Logical Volume + auto resize filesystem |
| 🆕 **Create LV** | Buat LV baru dengan pilihan filesystem & mount point |
| 📸 **Snapshot LV** | Buat LVM snapshot sebelum update |
| ↩️ **Restore Snapshot** | Merge snapshot kembali ke origin volume |

## Requirement

- Linux dengan `lvm2` terinstall:
  ```bash
  # Debian/Ubuntu
  apt install lvm2

  # RHEL/CentOS/Fedora
  dnf install lvm2

  # Arch Linux
  pacman -S lvm2
  ```
- Panel harus berjalan sebagai `root` atau user dengan akses sudo untuk `pvs`, `vgs`, `lvs`, `lvcreate`, dll.

## Cara Install

1. Plugin sudah ada di `plugins/lvm-manager/`
2. Buka panel → **Settings → Plugins**
3. Temukan **LVM Manager** → klik **Install**
4. Restart panel jika diperlukan

Atau install manual via DB (setelah panel pernah start sekali):
```bash
sqlite3 storage/panelku.db \
  "UPDATE settings SET value=json_insert(COALESCE(value,'[]'), '\$[#]', 'lvm-manager') WHERE key='installed_plugins';"
```

## Keamanan

- Semua input device path divalidasi dengan regex `^\/dev\/[\w]+$`
- Semua nama LV/VG divalidasi dengan `^[\w-]+$`
- Operasi destruktif (initialize disk) memerlukan konfirmasi checkbox eksplisit
- Command snapshot/restore mengunakan `lvconvert --merge` yang aman

## Demo Mode

Jika `lvm2` tidak terdeteksi (atau bukan Linux), plugin menampilkan **data demo** sehingga tetap bisa dieksplorasi UI-nya di lingkungan development.
