# Aşama 1 — Altyapı

**Tarih:** 18 Kasım 2026  
**Kapsam:** Başlangıç paketinin çalıştırılması ve servis/replikasyon doğrulaması.

## Çalıştırılan komutlar

```powershell
docker compose up -d
docker compose ps -a
docker compose exec -T mysql-replica mysql -uroot -p<ROOT_PASSWORD> -e "SHOW REPLICA STATUS\G"
docker compose exec -T mysql-primary mysql -u<APP_USER> -p<APP_PASSWORD> yemekhane -e "CALL sp_bakiye_yukle(7, 100)"
docker compose exec -T mysql-replica mysql -u<APP_USER> -p<APP_PASSWORD> yemekhane -e "SELECT id, bakiye FROM kullanicilar WHERE id = 7"
docker compose exec -T mysql-replica mysql -u<APP_USER> -p<APP_PASSWORD> yemekhane -e "CALL sp_bakiye_yukle(7, 50)"
docker compose exec -T redis redis-cli ping
```

Bağlantı bilgileri başlangıç paketindeki `README.md` dosyasındadır. Replikanın yeniden başlatma testi için replika durduruldu, kaynakta `CALL sp_bakiye_yukle(7, 200)` çalıştırıldı ve replika tekrar başlatıldı.

## Sonuçlar

`docker compose ps -a` çıktısında `mysql-primary`, `mysql-replica`, `redis` ve `frontend` servislerinin tamamı `healthy`; `replica-setup` servisi `Exited (0)` durumundaydı.

Replikasyon durumu:

```text
Replica_IO_Running: Yes
Replica_SQL_Running: Yes
Seconds_Behind_Source: 0
Last_IO_Errno: 0
Last_SQL_Errno: 0
```

Kaynak veritabanındaki 100 TL bakiye yüklemesinden sonra kullanıcı `id=7` için replikadan okunan bakiye `755.00` idi. Replika üzerinde bakiye yükleme denemesi beklenen `ERROR 1290` salt-okunur hatasıyla reddedildi. Replika durdurulmuşken kaynakta yapılan 200 TL yükleme sonrasında replika yeniden başlatıldı; güncel bakiye `955.00` olarak replika üzerinde görüldü.

`redis-cli ping` sonucu `PONG` oldu. Frontend sağlık uç noktası (`/saglik.txt`) başarılı yanıt verdi.

> Doğrulama amacıyla başlangıç verisindeki kullanıcı `id=7` için toplam 300 TL bakiye yükleme yordamı çalıştırılmıştır. Veritabanı sıfırlanmamış, `docker compose down -v` kullanılmamıştır.
